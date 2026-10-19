import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../../common/errors/http-error.js';
import { TenantService } from '../../../database/tenant.service.js';
import { OrgRole } from '../entities/org-member.entity.js';
import { orgRoleRank, type OrgMembership } from '../org-roles.js';
import type { AssignableOrgRole, OrgMemberDto } from './dto/member.dto.js';
import { audit, AuditAction } from '../../audit/audit.js';

const memberNotFound = () => HttpError.notFound('Member not found', 'MEMBER_NOT_FOUND');

@Injectable()
export class OrgMemberService {
  constructor(private readonly tenant: TenantService) {}

  /** Everyone in the workspace, owner first. Emails only for staff (moderator and above). */
  list(me: OrgMembership): Promise<OrgMemberDto[]> {
    const showEmail = orgRoleRank(me.role) >= orgRoleRank(OrgRole.Moderator);
    return this.tenant.withTenant(me.orgId, async (m) => {
      // users is global (no RLS); org_members limits the join to this workspace
      const rows: { user_id: string; name: string; email: string; role: OrgRole; joined_at: Date }[] =
        await m.query(
          `SELECT m.user_id, u.name, u.email, m.role, m.joined_at
           FROM org_members m
           JOIN users u ON u.id = m.user_id
           WHERE m.org_id = $1
           ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END,
                    u.name`,
          [me.orgId],
        );
      return rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        ...(showEmail && { email: r.email }),
        role: r.role,
        joinedAt: r.joined_at,
      }));
    });
  }

  /**
   * Changes someone's role, within the hierarchy: you can only change people
   * ranked below you, and only to roles below your own. So the owner appoints
   * admins, and admins appoint moderators. Ownership moves only through
   * transferOwnership.
   */
  async changeRole(me: OrgMembership, userId: string, role: AssignableOrgRole): Promise<void> {
    if (userId === me.userId) {
      throw HttpError.badRequest('You cannot change your own role', 'CANNOT_CHANGE_OWN_ROLE');
    }
    if (orgRoleRank(role) >= orgRoleRank(me.role)) {
      throw HttpError.forbidden(`Only someone above ${role} can assign it`, 'INSUFFICIENT_ORG_ROLE');
    }
    await this.tenant.withTenant(me.orgId, async (m) => {
      const target = await this.roleOf(m, me.orgId, userId);
      if (!target) throw memberNotFound();
      if (orgRoleRank(target) >= orgRoleRank(me.role)) {
        throw HttpError.forbidden('You can only change roles of people ranked below you', 'INSUFFICIENT_ORG_ROLE');
      }
      await m.query(`UPDATE org_members SET role = $3, updated_at = now() WHERE org_id = $1 AND user_id = $2`, [
        me.orgId,
        userId,
        role,
      ]);
      await audit(m, {
        actorId: me.userId,
        action: AuditAction.OrgMemberRoleChanged,
        subjectUserId: userId,
        details: { from: target, to: role },
      });
    });
  }

  /**
   * Removes someone from the workspace, and by cascade from all its clubs.
   * Only people ranked below you: moderators remove members, admins also
   * remove moderators, the owner removes anyone.
   */
  async remove(me: OrgMembership, userId: string): Promise<void> {
    if (userId === me.userId) {
      throw HttpError.badRequest('To leave the workspace, use leave instead', 'CANNOT_REMOVE_SELF');
    }
    await this.tenant.withTenant(me.orgId, async (m) => {
      const target = await this.roleOf(m, me.orgId, userId);
      if (!target) throw memberNotFound();
      if (orgRoleRank(target) >= orgRoleRank(me.role)) {
        throw HttpError.forbidden('You can only remove members ranked below you', 'INSUFFICIENT_ORG_ROLE');
      }
      await this.assertOwnsNoClub(m, me.orgId, userId, 'They own a club; transfer it before removing them');
      await m.query(`DELETE FROM org_members WHERE org_id = $1 AND user_id = $2`, [me.orgId, userId]);
      await audit(m, { actorId: me.userId, action: AuditAction.OrgMemberRemoved, subjectUserId: userId });
    });
  }

  /** Leaves the workspace and all its clubs. The owner must transfer ownership first. */
  async leave(me: OrgMembership): Promise<void> {
    if (me.role === OrgRole.Owner) {
      throw HttpError.conflict('Transfer ownership before leaving', 'OWNER_CANNOT_LEAVE');
    }
    await this.tenant.withTenant(me.orgId, async (m) => {
      await this.assertOwnsNoClub(m, me.orgId, me.userId, 'You own a club; transfer it before leaving');
      await m.query(`DELETE FROM org_members WHERE org_id = $1 AND user_id = $2`, [me.orgId, me.userId]);
    });
  }

  /**
   * Makes another member the owner; the current owner becomes an admin. The
   * default club's Owner role moves with it, since small workspaces only
   * ever use that club and its owner is the workspace owner.
   */
  async transferOwnership(me: OrgMembership, userId: string): Promise<void> {
    if (userId === me.userId) {
      throw HttpError.badRequest('You already own this workspace', 'ALREADY_OWNER');
    }
    await this.tenant.withTenant(me.orgId, async (m) => {
      if (!(await this.roleOf(m, me.orgId, userId))) throw memberNotFound();

      // demote first: the one-owner unique index would reject two owners even
      // for a moment
      await m.query(
        `UPDATE org_members SET role = 'admin', updated_at = now() WHERE org_id = $1 AND user_id = $2`,
        [me.orgId, me.userId],
      );
      await m.query(
        `UPDATE org_members SET role = 'owner', updated_at = now() WHERE org_id = $1 AND user_id = $2`,
        [me.orgId, userId],
      );

      await this.moveDefaultClubOwnership(m, me.orgId, me.userId, userId);
      await audit(m, { actorId: me.userId, action: AuditAction.OrgOwnershipTransferred, subjectUserId: userId });
    });
  }

  private async moveDefaultClubOwnership(
    m: EntityManager,
    orgId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<void> {
    const [club]: { club_id: string; owner_role_id: string; next_role_id: string | null }[] = await m.query(
      `SELECT c.id AS club_id,
              (SELECT id FROM roles WHERE club_id = c.id AND is_owner) AS owner_role_id,
              (SELECT id FROM roles WHERE club_id = c.id AND NOT is_owner
               ORDER BY position DESC LIMIT 1) AS next_role_id
       FROM clubs c WHERE c.org_id = $1 AND c.is_default`,
      [orgId],
    );
    if (!club) return;

    // the new owner may not be in the default club yet
    await m.query(
      `INSERT INTO club_members (club_id, user_id, org_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [club.club_id, toUserId, orgId],
    );
    await m.query(`DELETE FROM member_roles WHERE role_id = $1`, [club.owner_role_id]);
    await m.query(
      `INSERT INTO member_roles (club_id, user_id, role_id, org_id, assigned_by) VALUES ($1, $2, $3, $4, $5)`,
      [club.club_id, toUserId, club.owner_role_id, orgId, fromUserId],
    );
    // the previous owner keeps running the club, one step down
    if (club.next_role_id) {
      await m.query(
        `INSERT INTO member_roles (club_id, user_id, role_id, org_id, assigned_by)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [club.club_id, fromUserId, club.next_role_id, orgId, toUserId],
      );
    }
  }

  /**
   * Removing a club's owner would cascade away their Owner role and leave
   * the club with nobody in charge.
   */
  private async assertOwnsNoClub(m: EntityManager, orgId: string, userId: string, message: string) {
    const rows: unknown[] = await m.query(
      `SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
       WHERE mr.org_id = $1 AND mr.user_id = $2 AND r.is_owner LIMIT 1`,
      [orgId, userId],
    );
    if (rows.length > 0) throw HttpError.conflict(message, 'OWNS_CLUB');
  }

  private async roleOf(m: EntityManager, orgId: string, userId: string): Promise<OrgRole | null> {
    const [row]: { role: OrgRole }[] = await m.query(
      `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
    return row?.role ?? null;
  }
}
