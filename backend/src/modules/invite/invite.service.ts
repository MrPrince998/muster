import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { TenantService } from '../../database/tenant.service.js';
import type { ClubAccess } from '../permission/club-access.js';
import type {
  AcceptInviteResultDto,
  ClubJoinRequestDto,
  ClubDirectoryEntryDto,
  CreateInviteDto,
  InviteDto,
  InvitePreviewDto,
  InviteStatus,
} from './dto/invite.dto.js';
import { audit, AuditAction } from '../audit/audit.js';
import type { OrgMembership } from '../organisation/org-roles.js';

const inviteNotFound = () => HttpError.notFound('This invite link does not exist', 'INVITE_NOT_FOUND');
const requestNotFound = () =>
  HttpError.notFound('No pending request with that id; it may already be decided', 'JOIN_REQUEST_NOT_FOUND');

// why a link that exists can't be used; 410 Gone: it worked once, it won't again
const GONE: Record<Exclude<InviteStatus, 'active'>, () => HttpError> = {
  revoked: () => new HttpError(HttpStatus.GONE, 'This invite link was turned off', 'INVITE_REVOKED'),
  expired: () => new HttpError(HttpStatus.GONE, 'This invite link has expired', 'INVITE_EXPIRED'),
  used_up: () => new HttpError(HttpStatus.GONE, 'This invite link has been used up', 'INVITE_USED_UP'),
};

interface InviteRow {
  id: string;
  code: string;
  club_id: string;
  default_role_id: string | null;
  role_name: string | null;
  requires_approval: boolean;
  max_uses: number | null;
  use_count: number;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_by_name: string | null;
  created_at: Date;
}

/** Same order of checks the atomic UPDATE in accept() applies. */
function statusOf(row: Pick<InviteRow, 'revoked_at' | 'expires_at' | 'max_uses' | 'use_count'>): InviteStatus {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && row.expires_at <= new Date()) return 'expired';
  if (row.max_uses !== null && row.use_count >= row.max_uses) return 'used_up';
  return 'active';
}

const toDto = (row: InviteRow): InviteDto => ({
  id: row.id,
  code: row.code,
  clubId: row.club_id,
  role: row.default_role_id ? { id: row.default_role_id, name: row.role_name ?? '' } : null,
  maxUses: row.max_uses,
  useCount: row.use_count,
  expiresAt: row.expires_at,
  status: statusOf(row),
  requiresApproval: row.requires_approval,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
});

const SELECT_INVITES = `
  SELECT i.id, i.code, i.club_id, i.default_role_id, r.name AS role_name, i.requires_approval,
         i.max_uses, i.use_count, i.expires_at, i.revoked_at, u.name AS created_by_name, i.created_at
  FROM invites i
  LEFT JOIN roles r ON r.id = i.default_role_id
  LEFT JOIN users u ON u.id = i.created_by`;

@Injectable()
export class InviteService {
  constructor(private readonly tenant: TenantService) {}

  // --- managing a club's links (invite.manage) --------------------------------

  /** The club's links that haven't been turned off, newest first. */
  list(access: ClubAccess): Promise<InviteDto[]> {
    return this.inClub(access, async (m) => {
      const rows: InviteRow[] = await m.query(
        `${SELECT_INVITES} WHERE i.club_id = $1 AND i.revoked_at IS NULL ORDER BY i.created_at DESC`,
        [access.clubId],
      );
      return rows.map(toDto);
    });
  }

  /**
   * Creates a link. A role it gives must be one you could assign yourself
   * (strictly below your own), so a link can never hand out more than you have.
   */
  create(access: ClubAccess, dto: CreateInviteDto): Promise<InviteDto> {
    return this.inClub(access, async (m, orgId) => {
      if (dto.defaultRoleId) {
        const roles: { position: number; is_owner: boolean }[] = await m.query(
          `SELECT position, is_owner FROM roles WHERE id = $1 AND club_id = $2`,
          [dto.defaultRoleId, access.clubId],
        );
        const role = roles[0];
        if (!role) throw HttpError.badRequest('That role is not in this club', 'ROLE_NOT_FOUND');
        if (!access.canManageRole({ position: role.position, isOwner: role.is_owner })) {
          throw HttpError.forbidden('You can only give roles below your own', 'ROLE_TOO_HIGH');
        }
      }

      // 128 random bits: unguessable, and URL-safe as it is
      const code = randomBytes(16).toString('base64url');
      const [{ id }]: { id: string }[] = await m.query(
        `INSERT INTO invites (org_id, club_id, code, default_role_id, max_uses, expires_at, created_by, requires_approval)
         VALUES ($1, $2, $3, $4, $5,
                 CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(days => $6::int) END,
                 $7, $8)
         RETURNING id`,
        [
          orgId,
          access.clubId,
          code,
          dto.defaultRoleId ?? null,
          dto.maxUses ?? null,
          dto.expiresInDays ?? null,
          access.userId,
          dto.requiresApproval ?? false,
        ],
      );
      const [row]: InviteRow[] = await m.query(`${SELECT_INVITES} WHERE i.id = $1`, [id]);
      const invite = toDto(row);
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.ClubInviteCreated,
        clubId: access.clubId,
        details: {
          role: invite.role?.name ?? null,
          maxUses: dto.maxUses ?? null,
          expiresInDays: dto.expiresInDays ?? null,
          requiresApproval: dto.requiresApproval ?? false,
        },
      });
      return invite;
    });
  }

  /** Turns a link off. Kept, not deleted, so join requests still point at it. */
  revoke(access: ClubAccess, inviteId: string): Promise<void> {
    return this.inClub(access, async (m) => {
      const [rows]: [unknown[], number] = await m.query(
        `UPDATE invites SET revoked_at = now() WHERE id = $1 AND club_id = $2 AND revoked_at IS NULL RETURNING id`,
        [inviteId, access.clubId],
      );
      if (rows.length === 0) throw inviteNotFound();
      await audit(m, { actorId: access.userId, action: AuditAction.ClubInviteRevoked, clubId: access.clubId });
    });
  }

  // --- using a link (any signed-in person) ------------------------------------

  /** What the link leads to, and whether it still works. */
  async preview(user: AuthUser, code: string): Promise<InvitePreviewDto> {
    return this.byCode(code, async (m, invite) => ({
      status: statusOf(invite),
      workspaceName: invite.org_name,
      workspaceSlug: invite.org_slug,
      clubId: invite.club_id,
      clubName: invite.club_name,
      clubIsDefault: invite.club_is_default,
      roleName: invite.role_name,
      alreadyMember: await this.inClubAlready(m, invite.club_id, user.id),
      requiresApproval: invite.requires_approval,
      pendingRequest: await this.hasPendingRequest(m, invite.club_id, user.id),
    }));
  }

  /**
   * Uses the link, all in one transaction. Someone already in the club, or
   * already waiting on a request, takes no use. Otherwise a use is taken
   * atomically (the last one can't go twice), then either:
   *  - the link needs approval: a pending request is filed for the club's
   *    approvers ("used" when asked, so max_uses also caps pending requests)
   *  - it doesn't: they join (workspace, General, the club, the link's role)
   */
  async accept(user: AuthUser, code: string): Promise<AcceptInviteResultDto> {
    return this.byCode(code, async (m, invite) => {
      const result = { workspaceSlug: invite.org_slug, clubId: invite.club_id };
      if (await this.inClubAlready(m, invite.club_id, user.id)) return { ...result, status: 'already_member' as const };
      if (invite.requires_approval && (await this.hasPendingRequest(m, invite.club_id, user.id))) {
        return { ...result, status: 'requested' as const };
      }

      const [used]: [unknown[], number] = await m.query(
        `UPDATE invites SET use_count = use_count + 1
         WHERE id = $1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
           AND (max_uses IS NULL OR use_count < max_uses)
         RETURNING id`,
        [invite.id],
      );
      if (used.length === 0) {
        const status = statusOf(invite);
        throw GONE[status === 'active' ? 'used_up' : status](); // active here: the last use just went
      }

      if (invite.requires_approval) {
        await m.query(
          `INSERT INTO join_requests (org_id, club_id, invite_id, user_id) VALUES ($1, $2, $3, $4)`,
          [invite.org_id, invite.club_id, invite.id, user.id],
        );
        return { ...result, status: 'requested' as const };
      }

      await joinClub(m, {
        orgId: invite.org_id,
        clubId: invite.club_id,
        userId: user.id,
        roleId: invite.default_role_id,
        assignedBy: invite.created_by,
      });
      return { ...result, status: 'joined' as const };
    });
  }

  // --- reviewing requests (member.approve) ------------------------------------

  /** People waiting to get into this club, oldest first. */
  pendingRequests(access: ClubAccess): Promise<ClubJoinRequestDto[]> {
    return this.inClub(access, async (m) => {
      // users is global (no RLS); join_requests limits the join to this club
      const rows: {
        id: string;
        user_id: string;
        name: string;
        email: string;
        role_name: string | null;
        message: string | null;
        via_link: boolean;
        created_at: Date;
      }[] =
        await m.query(
          `SELECT jr.id, jr.user_id, u.name, u.email, r.name AS role_name, jr.message,
                  (jr.invite_id IS NOT NULL) AS via_link, jr.created_at
           FROM join_requests jr
           JOIN users u ON u.id = jr.user_id
           LEFT JOIN invites i ON i.id = jr.invite_id
           LEFT JOIN roles r ON r.id = i.default_role_id
           WHERE jr.club_id = $1 AND jr.status = 'pending'
           ORDER BY jr.created_at`,
          [access.clubId],
        );
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: r.name,
        email: r.email,
        roleName: r.role_name,
        message: r.message,
        viaLink: r.via_link,
        createdAt: r.created_at,
      }));
    });
  }

  /**
   * Lets them in, with the role of the link they used. The request is locked
   * and must still be pending, so two approvers can't both act on it.
   */
  approve(access: ClubAccess, requestId: string): Promise<void> {
    return this.inClub(access, async (m, orgId) => {
      const request = await this.lockPending(m, access, requestId);
      await joinClub(m, {
        orgId,
        clubId: access.clubId,
        userId: request.user_id,
        roleId: request.default_role_id,
        assignedBy: access.userId,
      });
      await this.decide(m, requestId, 'approved', access.userId);
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.ClubJoinApproved,
        clubId: access.clubId,
        subjectUserId: request.user_id,
      });
    });
  }

  /** Declines. They could ask again through a link that still works. */
  reject(access: ClubAccess, requestId: string): Promise<void> {
    return this.inClub(access, async (m) => {
      const request = await this.lockPending(m, access, requestId);
      await this.decide(m, requestId, 'rejected', access.userId);
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.ClubJoinRejected,
        clubId: access.clubId,
        subjectUserId: request.user_id,
      });
    });
  }

  // --- the club directory (any workspace member) ----------------------------------

  /**
   * The workspace's clubs someone could join, and the ones they're in: all
   * but the invite-only ones they aren't in (and the default club, which
   * everyone is in). Each says whether they're in it or have asked.
   */
  directory(me: OrgMembership): Promise<ClubDirectoryEntryDto[]> {
    return this.tenant.withTenant(me.orgId, async (m) => {
      const rows: {
        id: string;
        name: string;
        description: string | null;
        join_policy: 'open' | 'request' | 'invite';
        member_count: number;
        upcoming_count: number;
        is_member: boolean;
        requested: boolean;
      }[] = await m.query(
        `SELECT c.id, c.name, c.description, c.join_policy,
                (SELECT count(*) FROM club_members x WHERE x.club_id = c.id)::int AS member_count,
                (SELECT count(*) FROM events e
                  WHERE e.club_id = c.id AND e.status = 'published' AND e.starts_at > now())::int AS upcoming_count,
                EXISTS (SELECT 1 FROM club_members cm WHERE cm.club_id = c.id AND cm.user_id = $1) AS is_member,
                EXISTS (SELECT 1 FROM join_requests jr
                        WHERE jr.club_id = c.id AND jr.user_id = $1 AND jr.status = 'pending') AS requested
         FROM clubs c
         WHERE NOT c.is_default
           AND (c.join_policy <> 'invite'
                OR EXISTS (SELECT 1 FROM club_members cm WHERE cm.club_id = c.id AND cm.user_id = $1))
         ORDER BY lower(c.name)`,
        [me.userId],
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        joinPolicy: r.join_policy,
        memberCount: r.member_count,
        upcomingCount: r.upcoming_count,
        isMember: r.is_member,
        requested: r.requested,
      }));
    });
  }

  /**
   * Joins a club from the directory: straight in if it's open, or asks if it
   * asks (its approvers decide, from the club's settings). Invite-only clubs
   * take an invite link instead. Asking twice is one request.
   */
  joinFromDirectory(me: OrgMembership, clubId: string, message?: string): Promise<{ status: 'joined' | 'requested' }> {
    return this.tenant.withTenant(me.orgId, async (m) => {
      const [club]: { join_policy: 'open' | 'request' | 'invite'; is_default: boolean }[] = await m.query(
        `SELECT join_policy, is_default FROM clubs WHERE id = $1 FOR UPDATE`,
        [clubId],
      );
      if (!club) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
      const [member]: unknown[] = await m.query(`SELECT 1 FROM club_members WHERE club_id = $1 AND user_id = $2`, [
        clubId,
        me.userId,
      ]);
      if (member || club.is_default) throw HttpError.conflict("You're in this club already", 'ALREADY_IN_CLUB');
      if (club.join_policy === 'invite') {
        throw HttpError.forbidden('This club takes people with an invite link', 'CLUB_INVITE_ONLY');
      }
      if (club.join_policy === 'open') {
        await joinClub(m, { orgId: me.orgId, clubId, userId: me.userId, roleId: null, assignedBy: null });
        return { status: 'joined' as const };
      }
      await m.query(
        `INSERT INTO join_requests (org_id, club_id, invite_id, user_id, message)
         VALUES ($1, $2, NULL, $3, $4)
         ON CONFLICT (club_id, user_id) WHERE status = 'pending' DO UPDATE SET message = EXCLUDED.message`,
        [me.orgId, clubId, me.userId, message?.trim() || null],
      );
      return { status: 'requested' as const };
    });
  }

  /** Takes back a request to join a club. */
  cancelDirectoryRequest(me: OrgMembership, clubId: string): Promise<void> {
    return this.tenant.withTenant(me.orgId, async (m) => {
      const [rows]: [unknown[], number] = await m.query(
        `DELETE FROM join_requests WHERE club_id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
        [clubId, me.userId],
      );
      if (rows.length === 0) throw HttpError.notFound("You haven't asked to join this club", 'JOIN_REQUEST_NOT_FOUND');
    });
  }

  // --- helpers -------------------------------------------------------------------

  private async inClub<T>(access: ClubAccess, work: (m: EntityManager, orgId: string) => Promise<T>): Promise<T> {
    const orgId = await this.tenant.orgIdForClub(access.clubId);
    if (!orgId) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
    return this.tenant.withTenant(orgId, (m) => work(m, orgId));
  }

  // The code carries no tenant, so find its workspace first (SECURITY DEFINER),
  // then read the invite inside it. The row is locked for accept().
  private async byCode<T>(
    code: string,
    work: (m: EntityManager, invite: InviteRow & InviteContext) => Promise<T>,
  ): Promise<T> {
    if (code.length > 64) throw inviteNotFound();
    const orgId = await this.tenant.orgIdForInviteCode(code);
    if (!orgId) throw inviteNotFound();
    return this.tenant.withTenant(orgId, async (m) => {
      const rows: (InviteRow & InviteContext)[] = await m.query(
        `SELECT i.id, i.code, i.club_id, i.default_role_id, r.name AS role_name, i.requires_approval,
                i.max_uses, i.use_count, i.expires_at, i.revoked_at, NULL AS created_by_name, i.created_at,
                i.created_by, i.org_id, o.name AS org_name, o.slug AS org_slug,
                c.name AS club_name, c.is_default AS club_is_default
         FROM invites i
         JOIN clubs c ON c.id = i.club_id
         JOIN organisations o ON o.id = i.org_id
         LEFT JOIN roles r ON r.id = i.default_role_id
         WHERE i.code = $1
         FOR UPDATE OF i`,
        [code],
      );
      if (!rows[0]) throw inviteNotFound();
      return work(m, rows[0]);
    });
  }

  private async lockPending(
    m: EntityManager,
    access: ClubAccess,
    requestId: string,
  ): Promise<{ user_id: string; default_role_id: string | null }> {
    const rows: { user_id: string; default_role_id: string | null }[] = await m.query(
      `SELECT jr.user_id, i.default_role_id
       FROM join_requests jr LEFT JOIN invites i ON i.id = jr.invite_id
       WHERE jr.id = $1 AND jr.club_id = $2 AND jr.status = 'pending'
       FOR UPDATE OF jr`,
      [requestId, access.clubId],
    );
    if (!rows[0]) throw requestNotFound();
    return rows[0];
  }

  private decide(m: EntityManager, requestId: string, status: 'approved' | 'rejected', by: string) {
    return m.query(`UPDATE join_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [
      requestId,
      status,
      by,
    ]);
  }

  private async hasPendingRequest(m: EntityManager, clubId: string, userId: string): Promise<boolean> {
    const rows: unknown[] = await m.query(
      `SELECT 1 FROM join_requests WHERE club_id = $1 AND user_id = $2 AND status = 'pending'`,
      [clubId, userId],
    );
    return rows.length > 0;
  }

  private async inClubAlready(m: EntityManager, clubId: string, userId: string): Promise<boolean> {
    const rows: unknown[] = await m.query(`SELECT 1 FROM club_members WHERE club_id = $1 AND user_id = $2`, [
      clubId,
      userId,
    ]);
    return rows.length > 0;
  }
}

interface InviteContext {
  org_id: string;
  org_name: string;
  org_slug: string;
  club_name: string;
  club_is_default: boolean;
  created_by: string | null;
}

/**
 * Puts someone in a club the way a link does: the workspace (as a member)
 * and its default club if they aren't in it yet, then the club, then the
 * role. Everything is "if not already", so it's safe to repeat.
 */
async function joinClub(
  m: EntityManager,
  join: { orgId: string; clubId: string; userId: string; roleId: string | null; assignedBy: string | null },
): Promise<void> {
  const joinedWorkspace: unknown[] = await m.query(
    `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING RETURNING user_id`,
    [join.orgId, join.userId],
  );
  if (joinedWorkspace.length > 0) {
    // every new member of a workspace is in its default club
    await m.query(
      `INSERT INTO club_members (club_id, user_id, org_id)
       SELECT id, $2, $1 FROM clubs WHERE org_id = $1 AND is_default
       ON CONFLICT DO NOTHING`,
      [join.orgId, join.userId],
    );
  }
  await m.query(`INSERT INTO club_members (club_id, user_id, org_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
    join.clubId,
    join.userId,
    join.orgId,
  ]);
  if (join.roleId) {
    await m.query(
      `INSERT INTO member_roles (club_id, user_id, role_id, org_id, assigned_by)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [join.clubId, join.userId, join.roleId, join.orgId, join.assignedBy],
    );
  }
}
