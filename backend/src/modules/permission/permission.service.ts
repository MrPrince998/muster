import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantService } from '../../database/tenant.service.js';
import { ClubAccess } from './club-access.js';
import type { Permission } from './permissions.js';

interface ClubAccessRow {
  is_owner: boolean;
  highest_position: number;
  permissions: Permission[];
}

@Injectable()
export class PermissionService {
  constructor(private readonly tenant: TenantService) {}

  /**
   * Resolves a user's access in a club. Returns null if the club does not
   * exist or they are not a member of it.
   *
   * Pass a manager when already inside withTenant() to reuse that transaction;
   * otherwise the club's org is looked up and a tenant transaction opened.
   */
  async getClubAccess(
    clubId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<ClubAccess | null> {
    if (manager) return this.queryClubAccess(manager, clubId, userId);

    const orgId = await this.tenant.orgIdForClub(clubId);
    if (!orgId) return null;
    return this.tenant.withTenant(orgId, (m) => this.queryClubAccess(m, clubId, userId));
  }

  private async queryClubAccess(
    manager: EntityManager,
    clubId: string,
    userId: string,
  ): Promise<ClubAccess | null> {
    // Starts from club_members so a member with no roles still gets a row
    // (empty permissions), while a non-member gets none. unnest flattens every
    // held role's permission array so they can be merged with DISTINCT.
    const rows: ClubAccessRow[] = await manager.query(
      `
      SELECT
        COALESCE(bool_or(r.is_owner), false)                    AS is_owner,
        COALESCE(max(r.position), 0)::int                       AS highest_position,
        COALESCE(
          array_agg(DISTINCT p.permission) FILTER (WHERE p.permission IS NOT NULL),
          '{}'
        )                                                       AS permissions
      FROM club_members cm
      LEFT JOIN member_roles mr
        ON mr.club_id = cm.club_id AND mr.user_id = cm.user_id
      LEFT JOIN roles r
        ON r.id = mr.role_id
      LEFT JOIN LATERAL unnest(r.permissions) AS p(permission) ON true
      WHERE cm.club_id = $1 AND cm.user_id = $2
      GROUP BY cm.club_id, cm.user_id
      `,
      [clubId, userId],
    );

    const row = rows[0];
    if (!row) return null;

    return new ClubAccess(clubId, userId, row.is_owner, row.highest_position, row.permissions);
  }
}
