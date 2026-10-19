import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { TenantService } from '../../database/tenant.service.js';
import type { ClubAccess } from '../permission/club-access.js';
import type { Permission } from '../permission/permissions.js';
import type { ClubMemberDto, ClubRoleDto, CreateRoleDto, UpdateRoleDto } from './dto/club-admin.dto.js';
import { audit, AuditAction } from '../audit/audit.js';

// enough for any club; keeps the roles list (and positions under Owner's 100) small
export const MAX_ROLES = 25;

const memberNotFound = () => HttpError.notFound('Not a member of this club', 'MEMBER_NOT_FOUND');
const roleNotFound = () => HttpError.notFound('No such role in this club', 'ROLE_NOT_FOUND');
const memberAboveYou = () =>
  HttpError.forbidden('You can only manage people below you in the club', 'MEMBER_ABOVE_YOU');
const roleAboveYou = () => HttpError.forbidden('You can only manage roles below your own', 'ROLE_ABOVE_YOU');
const nameTaken = () => HttpError.conflict('This club already has a role with that name', 'ROLE_NAME_TAKEN');

interface MemberRow {
  user_id: string;
  name: string;
  joined_at: Date;
  is_owner: boolean;
  highest_position: number;
  role_ids: string[];
}

interface RoleRow {
  id: string;
  name: string;
  position: number;
  permissions: Permission[];
  is_owner: boolean;
}

// a club's members with their roles; $1 the club, $2 one member or null for all
const SELECT_MEMBERS = `
  SELECT u.id AS user_id, u.name, cm.joined_at,
         COALESCE(bool_or(r.is_owner), false)              AS is_owner,
         COALESCE(max(r.position), 0)::int                 AS highest_position,
         COALESCE(array_agg(r.id ORDER BY r.position DESC)
                  FILTER (WHERE r.id IS NOT NULL AND NOT r.is_owner), '{}') AS role_ids
  FROM club_members cm
  JOIN users u ON u.id = cm.user_id
  LEFT JOIN member_roles mr ON mr.club_id = cm.club_id AND mr.user_id = cm.user_id
  LEFT JOIN roles r ON r.id = mr.role_id
  WHERE cm.club_id = $1 AND ($2::uuid IS NULL OR cm.user_id = $2)
  GROUP BY u.id, u.name, cm.joined_at
  ORDER BY is_owner DESC, highest_position DESC, u.name`;

/**
 * Running a club: who's in it and what each person may do (members and their
 * roles), the roles themselves, and handing the club to someone else.
 *
 * Every change follows the hierarchy (README, "Role hierarchy"): you manage
 * only roles and people strictly below your own highest role, the Owner role
 * moves only by transfer, and a role can't be given a permission you don't
 * hold. Together these make it impossible to raise yourself, directly or
 * through someone else.
 */
@Injectable()
export class ClubAdminService {
  constructor(private readonly tenant: TenantService) {}

  // --- members ---------------------------------------------------------------

  members(access: ClubAccess): Promise<ClubMemberDto[]> {
    return this.inClub(access, async (m) => {
      const rows: MemberRow[] = await m.query(SELECT_MEMBERS, [access.clubId, null]);
      return rows.map((row) => this.toMember(row, access));
    });
  }

  /** Replaces the roles someone holds. Every role added or taken away must be below yours. */
  setMemberRoles(access: ClubAccess, userId: string, roleIds: string[]): Promise<ClubMemberDto> {
    return this.inClub(access, async (m, orgId) => {
      const target = await this.member(m, access, userId);
      if (!this.manageable(target, access)) throw memberAboveYou();

      const roles = await this.lockRoles(m, access.clubId);
      const byId = new Map(roles.map((role) => [role.id, role]));
      for (const id of roleIds) {
        const role = byId.get(id);
        if (!role || role.is_owner) throw roleNotFound();
      }

      const added = roleIds.filter((id) => !target.role_ids.includes(id));
      const removed = target.role_ids.filter((id) => !roleIds.includes(id));
      for (const id of [...added, ...removed]) {
        const role = byId.get(id)!;
        if (!access.canManageRole({ position: role.position, isOwner: role.is_owner })) throw roleAboveYou();
      }

      if (removed.length > 0) {
        await m.query(`DELETE FROM member_roles WHERE club_id = $1 AND user_id = $2 AND role_id = ANY($3::uuid[])`, [
          access.clubId,
          userId,
          removed,
        ]);
      }
      for (const id of added) {
        await m.query(
          `INSERT INTO member_roles (club_id, user_id, role_id, org_id, assigned_by) VALUES ($1, $2, $3, $4, $5)`,
          [access.clubId, userId, id, orgId, access.userId],
        );
      }
      if (added.length > 0 || removed.length > 0) {
        await audit(m, {
          actorId: access.userId,
          action: AuditAction.ClubMemberRolesChanged,
          clubId: access.clubId,
          subjectUserId: userId,
          details: { added: added.map((id) => byId.get(id)!.name), removed: removed.map((id) => byId.get(id)!.name) },
        });
      }
      return this.toMember(await this.member(m, access, userId), access);
    });
  }

  /** Takes someone out of the club (their roles go with them). Not the default club: that's the workspace. */
  async removeMember(access: ClubAccess, userId: string): Promise<void> {
    if (userId === access.userId) {
      throw HttpError.badRequest('To leave the club yourself, use leave', 'USE_LEAVE');
    }
    return this.inClub(access, async (m) => {
      await this.assertNotDefault(m, access.clubId, "Everyone in the workspace is in its default club; remove them from the workspace instead");
      const target = await this.member(m, access, userId);
      if (!this.manageable(target, access)) throw memberAboveYou();
      await m.query(`DELETE FROM club_members WHERE club_id = $1 AND user_id = $2`, [access.clubId, userId]);
      await audit(m, { actorId: access.userId, action: AuditAction.ClubMemberRemoved, clubId: access.clubId, subjectUserId: userId });
    });
  }

  /** Leaves the club. The owner hands it over first, so it's never left without one. */
  leave(access: ClubAccess): Promise<void> {
    return this.inClub(access, async (m) => {
      await this.assertNotDefault(m, access.clubId, "Everyone in the workspace is in its default club; leave the workspace instead");
      if (access.isOwner) {
        throw HttpError.conflict('You own this club; hand it to someone else before leaving', 'OWNS_CLUB');
      }
      await m.query(`DELETE FROM club_members WHERE club_id = $1 AND user_id = $2`, [access.clubId, access.userId]);
    });
  }

  /**
   * Hands the club to another member: they get the Owner role, and the
   * previous owner keeps running it from the most senior role below.
   */
  async transferOwnership(access: ClubAccess, userId: string): Promise<void> {
    if (!access.isOwner) throw HttpError.forbidden('Only the owner can hand the club over', 'NOT_OWNER');
    if (userId === access.userId) throw HttpError.badRequest('You already own this club', 'ALREADY_OWNER');
    return this.inClub(access, async (m, orgId) => {
      await this.member(m, access, userId);
      const roles = await this.lockRoles(m, access.clubId);
      const owner = roles.find((role) => role.is_owner)!;
      const next = roles.filter((role) => !role.is_owner).sort((a, b) => b.position - a.position)[0];

      await m.query(`DELETE FROM member_roles WHERE role_id = $1`, [owner.id]);
      await m.query(
        `INSERT INTO member_roles (club_id, user_id, role_id, org_id, assigned_by) VALUES ($1, $2, $3, $4, $5)`,
        [access.clubId, userId, owner.id, orgId, access.userId],
      );
      if (next) {
        await m.query(
          `INSERT INTO member_roles (club_id, user_id, role_id, org_id, assigned_by)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [access.clubId, access.userId, next.id, orgId, userId],
        );
      }
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.ClubOwnershipTransferred,
        clubId: access.clubId,
        subjectUserId: userId,
      });
    });
  }

  // --- roles -----------------------------------------------------------------

  /** The club's roles, most senior first (Owner not listed), each marked if you can manage it. */
  roles(access: ClubAccess): Promise<ClubRoleDto[]> {
    return this.inClub(access, (m) => this.roleList(m, access));
  }

  /** A new role, at the bottom: move it up once it's set up. */
  async createRole(access: ClubAccess, dto: CreateRoleDto): Promise<ClubRoleDto[]> {
    this.assertYours(access, dto.permissions);
    return this.inClub(access, async (m, orgId) => {
      const roles = await this.lockRoles(m, access.clubId);
      const others = roles.filter((role) => !role.is_owner).sort((a, b) => a.position - b.position);
      if (others.length >= MAX_ROLES) {
        throw HttpError.conflict(`A club can have up to ${MAX_ROLES} roles`, 'TOO_MANY_ROLES');
      }
      const top = others.at(-1)?.position ?? 0;
      let id: string;
      try {
        [{ id }] = await m.query(
          `INSERT INTO roles (org_id, club_id, name, position, permissions) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [orgId, access.clubId, dto.name, top + 1, dto.permissions],
        );
      } catch (error) {
        if (isUniqueViolation(error, 'roles_club_id_name_key')) throw nameTaken();
        throw error;
      }
      await this.renumber(m, [id, ...others.map((role) => role.id)]);
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.ClubRoleCreated,
        clubId: access.clubId,
        details: { role: dto.name, permissions: dto.permissions },
      });
      return this.roleList(m, access);
    });
  }

  /** Renames a role or changes what it allows. You can't add permissions you don't hold. */
  updateRole(access: ClubAccess, roleId: string, dto: UpdateRoleDto): Promise<ClubRoleDto[]> {
    return this.inClub(access, async (m) => {
      const role = (await this.lockRoles(m, access.clubId)).find((r) => r.id === roleId);
      if (!role || role.is_owner) throw roleNotFound();
      if (!access.canManageRole({ position: role.position, isOwner: false })) throw roleAboveYou();
      if (dto.permissions) {
        this.assertYours(
          access,
          dto.permissions.filter((p) => !role.permissions.includes(p)),
        );
      }
      try {
        await m.query(`UPDATE roles SET name = $2, permissions = $3, updated_at = now() WHERE id = $1`, [
          roleId,
          dto.name ?? role.name,
          dto.permissions ?? role.permissions,
        ]);
      } catch (error) {
        if (isUniqueViolation(error, 'roles_club_id_name_key')) throw nameTaken();
        throw error;
      }
      const granted = (dto.permissions ?? []).filter((p) => !role.permissions.includes(p));
      const revoked = dto.permissions ? role.permissions.filter((p) => !dto.permissions!.includes(p)) : [];
      const renamed = dto.name !== undefined && dto.name !== role.name;
      if (renamed || granted.length > 0 || revoked.length > 0) {
        await audit(m, {
          actorId: access.userId,
          action: AuditAction.ClubRoleUpdated,
          clubId: access.clubId,
          details: { role: dto.name ?? role.name, ...(renamed && { was: role.name }), granted, revoked },
        });
      }
      return this.roleList(m, access);
    });
  }

  /** Swaps a role with the one above or below it. Both must be below your own. */
  moveRole(access: ClubAccess, roleId: string, direction: 'up' | 'down'): Promise<ClubRoleDto[]> {
    return this.inClub(access, async (m) => {
      const ordered = (await this.lockRoles(m, access.clubId))
        .filter((role) => !role.is_owner)
        .sort((a, b) => a.position - b.position);
      const index = ordered.findIndex((role) => role.id === roleId);
      if (index === -1) throw roleNotFound();
      const swapWith = direction === 'up' ? index + 1 : index - 1;
      if (swapWith < 0 || swapWith >= ordered.length) {
        throw HttpError.conflict(`It's already at the ${direction === 'up' ? 'top' : 'bottom'}`, 'ROLE_AT_EDGE');
      }
      for (const role of [ordered[index], ordered[swapWith]]) {
        if (!access.canManageRole({ position: role.position, isOwner: false })) throw roleAboveYou();
      }
      [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
      await this.renumber(
        m,
        ordered.map((role) => role.id),
      );
      return this.roleList(m, access);
    });
  }

  /** Deletes a role: whoever held it loses it, and invite links that gave it give no role now. */
  deleteRole(access: ClubAccess, roleId: string): Promise<void> {
    return this.inClub(access, async (m) => {
      const role = (await this.lockRoles(m, access.clubId)).find((r) => r.id === roleId);
      if (!role || role.is_owner) throw roleNotFound();
      if (!access.canManageRole({ position: role.position, isOwner: false })) throw roleAboveYou();
      await m.query(`UPDATE invites SET default_role_id = NULL WHERE default_role_id = $1`, [roleId]);
      await m.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
      await audit(m, { actorId: access.userId, action: AuditAction.ClubRoleDeleted, clubId: access.clubId, details: { role: role.name } });
    });
  }

  // --- helpers ---------------------------------------------------------------

  private async inClub<T>(access: ClubAccess, work: (m: EntityManager, orgId: string) => Promise<T>): Promise<T> {
    const orgId = await this.tenant.orgIdForClub(access.clubId);
    if (!orgId) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
    return this.tenant.withTenant(orgId, (m) => work(m, orgId));
  }

  private async member(m: EntityManager, access: ClubAccess, userId: string): Promise<MemberRow> {
    const [row]: MemberRow[] = await m.query(SELECT_MEMBERS, [access.clubId, userId]);
    if (!row) throw memberNotFound();
    return row;
  }

  // you never manage yourself: not even an owner edits their own roles here
  private manageable(row: MemberRow, access: ClubAccess): boolean {
    return (
      row.user_id !== access.userId &&
      access.canManageMember({ highestPosition: row.highest_position, isOwner: row.is_owner })
    );
  }

  private toMember(row: MemberRow, access: ClubAccess): ClubMemberDto {
    return {
      userId: row.user_id,
      name: row.name,
      joinedAt: row.joined_at,
      isOwner: row.is_owner,
      roleIds: row.role_ids,
      manageable: this.manageable(row, access),
    };
  }

  // all of the club's roles, locked: role changes in one club happen one at a time
  private lockRoles(m: EntityManager, clubId: string): Promise<RoleRow[]> {
    return m.query(
      `SELECT id, name, position, permissions, is_owner FROM roles WHERE club_id = $1 ORDER BY position FOR UPDATE`,
      [clubId],
    );
  }

  private async roleList(m: EntityManager, access: ClubAccess): Promise<ClubRoleDto[]> {
    const rows: (RoleRow & { member_count: number })[] = await m.query(
      `SELECT r.id, r.name, r.position, r.permissions, r.is_owner,
              (SELECT count(*) FROM member_roles mr WHERE mr.role_id = r.id)::int AS member_count
       FROM roles r WHERE r.club_id = $1 AND NOT r.is_owner ORDER BY r.position DESC`,
      [access.clubId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      permissions: r.permissions,
      memberCount: r.member_count,
      assignable: access.canManageRole({ position: r.position, isOwner: false }),
    }));
  }

  // positions 1, 2, 3… in the given order, lowest first (the unique index is deferred, so swaps are fine)
  private async renumber(m: EntityManager, idsLowestFirst: string[]): Promise<void> {
    await m.query(
      `UPDATE roles r SET position = o.ord, updated_at = now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord)
       WHERE r.id = o.id`,
      [idsLowestFirst],
    );
  }

  private assertYours(access: ClubAccess, permissions: Permission[]): void {
    const missing = access.missing(permissions);
    if (missing.length > 0) {
      throw HttpError.forbidden("A role can't be given permissions you don't hold", 'PERMISSION_NOT_YOURS', {
        missing,
      });
    }
  }

  private async assertNotDefault(m: EntityManager, clubId: string, message: string): Promise<void> {
    const [club]: { is_default: boolean }[] = await m.query(`SELECT is_default FROM clubs WHERE id = $1`, [clubId]);
    if (club?.is_default) throw HttpError.conflict(message, 'DEFAULT_CLUB');
  }
}
