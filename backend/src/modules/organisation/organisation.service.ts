import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { TenantService } from '../../database/tenant.service.js';
import { ClubService } from '../club/club.service.js';
import type {
  CreateOrganisationDto,
  MyOrganisationDto,
  OrganisationDto,
  UpdateOrganisationDto,
} from './dto/organisation.dto.js';
import { JoinPolicy } from './entities/organisation.entity.js';
import { OrgRole } from './entities/org-member.entity.js';
import { orgNotFound } from './guards/org-member.guard.js';
import { orgRoleRank, type OrgMembership } from './org-roles.js';
import { RESERVED_SLUGS, slugify } from './slug.js';
import type { JoinResultDto, OrganisationPreviewDto } from './join-requests/dto/join-request.dto.js';
import { OrgJoinRequestService } from './join-requests/org-join-request.service.js';

const SLUG_CONSTRAINT = 'organisations_slug_key';
const slugTaken = () => HttpError.conflict('That URL is already taken', 'SLUG_TAKEN');

interface OrganisationRow {
  id: string;
  name: string;
  slug: string;
  join_policy: JoinPolicy;
  created_at: Date;
  updated_at: Date;
}

const toDto = (row: OrganisationRow, role: OrgRole): OrganisationDto => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  joinPolicy: row.join_policy,
  role,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

@Injectable()
export class OrganisationService {
  constructor(
    private readonly tenant: TenantService,
    private readonly clubs: ClubService,
    private readonly joinRequests: OrgJoinRequestService,
  ) {}

  /**
   * Creates a workspace, makes the creator its owner, and gives it a default
   * club ("General") with the default roles, the creator holding Owner. One
   * transaction: a workspace never exists without its owner or default club.
   */
  async create(user: AuthUser, dto: CreateOrganisationDto): Promise<OrganisationDto> {
    if (dto.slug && RESERVED_SLUGS.has(dto.slug)) {
      throw HttpError.badRequest('That URL is reserved', 'SLUG_RESERVED');
    }

    // A chosen slug that is taken is the caller's to fix. A generated one gets
    // a random suffix and another try: "state-uni" -> "state-uni-3f9a".
    const base = dto.slug ?? slugify(dto.name);
    const attempts = dto.slug ? 1 : 5;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      try {
        return await this.insert(user, dto, slug);
      } catch (error) {
        if (!isUniqueViolation(error, SLUG_CONSTRAINT)) throw error;
      }
    }
    throw slugTaken();
  }

  private insert(user: AuthUser, dto: CreateOrganisationDto, slug: string): Promise<OrganisationDto> {
    // The id is chosen here so the transaction can be scoped to the new
    // workspace before its row exists; RLS checks every insert against it.
    const orgId = randomUUID();
    return this.tenant.withTenant(orgId, async (m) => {
      const [row]: OrganisationRow[] = await m.query(
        `INSERT INTO organisations (id, name, slug, join_policy)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, join_policy, created_at, updated_at`,
        [orgId, dto.name, slug, dto.joinPolicy ?? JoinPolicy.Invite],
      );
      await m.query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        orgId,
        user.id,
      ]);
      await this.clubs.provision(m, {
        orgId,
        name: 'General',
        slug: 'general',
        isDefault: true,
        ownerId: user.id,
      });
      return toDto(row, OrgRole.Owner);
    });
  }

  /** Every workspace the user belongs to, with their role in each. */
  listMine(user: AuthUser): Promise<MyOrganisationDto[]> {
    return this.tenant.userOrganisations(user.id);
  }

  /** For the frontend's /o/:slug pages. 404 for non-members, as for unknown slugs. */
  async findBySlug(user: AuthUser, slug: string): Promise<OrganisationDto> {
    const orgId = await this.tenant.orgIdForSlug(slug);
    if (!orgId) throw orgNotFound();
    const found = await this.tenant.withTenant(orgId, async (m) => {
      const role = await this.roleOf(m, orgId, user.id);
      return role ? this.withStaffInfo(m, toDto(await this.load(m, orgId), role)) : null;
    });
    if (!found) throw orgNotFound();
    return found;
  }

  findOne(me: OrgMembership): Promise<OrganisationDto> {
    return this.tenant.withTenant(me.orgId, async (m) =>
      this.withStaffInfo(m, toDto(await this.load(m, me.orgId), me.role)),
    );
  }

  /** Adds what only moderators and above see: the size of the review queue. */
  private async withStaffInfo(m: EntityManager, org: OrganisationDto): Promise<OrganisationDto> {
    if (orgRoleRank(org.role) >= orgRoleRank(OrgRole.Moderator)) {
      org.pendingJoinRequests = await this.joinRequests.countPending(m, org.id);
    }
    return org;
  }

  async update(me: OrgMembership, dto: UpdateOrganisationDto): Promise<OrganisationDto> {
    if (dto.slug && RESERVED_SLUGS.has(dto.slug)) {
      throw HttpError.badRequest('That URL is reserved', 'SLUG_RESERVED');
    }
    try {
      return await this.tenant.withTenant(me.orgId, async (m) => {
        // COALESCE keeps any field the request leaves out
        const [rows]: [OrganisationRow[], number] = await m.query(
          `UPDATE organisations
           SET name = COALESCE($2, name),
               slug = COALESCE($3, slug),
               join_policy = COALESCE($4, join_policy),
               updated_at = now()
           WHERE id = $1
           RETURNING id, name, slug, join_policy, created_at, updated_at`,
          [me.orgId, dto.name ?? null, dto.slug ?? null, dto.joinPolicy ?? null],
        );
        return toDto(rows[0], me.role);
      });
    } catch (error) {
      if (isUniqueViolation(error, SLUG_CONSTRAINT)) throw slugTaken();
      throw error;
    }
  }

  /**
   * Deletes the workspace and, by cascade, every club, role, invite, event and
   * registration in it. The caller must retype the slug.
   */
  async remove(me: OrgMembership, confirmSlug: string): Promise<void> {
    await this.tenant.withTenant(me.orgId, async (m) => {
      const org = await this.load(m, me.orgId);
      if (org.slug !== confirmSlug.trim().toLowerCase()) {
        throw HttpError.badRequest('confirmSlug does not match the workspace URL', 'CONFIRMATION_MISMATCH');
      }
      await m.query(`DELETE FROM organisations WHERE id = $1`, [me.orgId]);
    });
  }

  /**
   * What a signed-in non-member may see before joining: enough for an
   * "apply to join" screen. Invite-only workspaces stay hidden (404) from
   * non-members, exactly like unknown slugs.
   */
  async preview(user: AuthUser, slug: string): Promise<OrganisationPreviewDto> {
    const orgId = await this.tenant.orgIdForSlug(slug);
    if (!orgId) throw orgNotFound();
    return this.tenant.withTenant(orgId, async (m) => {
      const org = await this.load(m, orgId);
      const isMember = (await this.roleOf(m, orgId, user.id)) !== null;
      if (!isMember && org.join_policy === JoinPolicy.Invite) throw orgNotFound();

      const [{ count }]: { count: number }[] = await m.query(
        `SELECT count(*)::int AS count FROM org_members WHERE org_id = $1`,
        [orgId],
      );
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        joinPolicy: org.join_policy,
        memberCount: count,
        isMember,
        pendingRequest: isMember ? null : await this.joinRequests.findPending(m, orgId, user.id),
      };
    });
  }

  /**
   * Joins by the workspace's join policy:
   *  - open: member at once, in the default club with no roles
   *  - request: files a request for a moderator to review
   *  - invite: refused; invite links are the only way in
   */
  async join(user: AuthUser, slug: string, message?: string): Promise<JoinResultDto> {
    const orgId = await this.tenant.orgIdForSlug(slug);
    if (!orgId) throw orgNotFound();

    return this.tenant.withTenant(orgId, async (m) => {
      const org = await this.load(m, orgId);
      if (await this.roleOf(m, orgId, user.id)) {
        throw HttpError.conflict('You are already a member of this workspace', 'ALREADY_MEMBER');
      }

      switch (org.join_policy) {
        case JoinPolicy.Open:
          await m.query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member')`, [
            orgId,
            user.id,
          ]);
          await m.query(
            `INSERT INTO club_members (club_id, user_id, org_id)
             SELECT id, $2, $1 FROM clubs WHERE org_id = $1 AND is_default`,
            [orgId, user.id],
          );
          return { status: 'joined', organisation: toDto(org, OrgRole.Member) };

        case JoinPolicy.Request:
          return { status: 'requested', request: await this.joinRequests.create(m, orgId, user.id, message) };

        default:
          // same 404 as preview: an invite-only workspace does not reveal itself
          throw orgNotFound();
      }
    });
  }

  /** Withdraws the user's own pending request to join. */
  async cancelJoinRequest(user: AuthUser, slug: string): Promise<void> {
    const orgId = await this.tenant.orgIdForSlug(slug);
    if (!orgId) throw orgNotFound();
    await this.tenant.withTenant(orgId, (m) => this.joinRequests.cancel(m, orgId, user.id));
  }

  private async load(m: EntityManager, orgId: string): Promise<OrganisationRow> {
    const [row]: OrganisationRow[] = await m.query(
      `SELECT id, name, slug, join_policy, created_at, updated_at FROM organisations WHERE id = $1`,
      [orgId],
    );
    if (!row) throw orgNotFound();
    return row;
  }

  private async roleOf(m: EntityManager, orgId: string, userId: string): Promise<OrgRole | null> {
    const [row]: { role: OrgRole }[] = await m.query(
      `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
    return row?.role ?? null;
  }
}
