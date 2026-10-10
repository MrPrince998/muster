import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ClubAccess } from './club-access.js';
import type { Permission } from './permissions.js';

interface ClubAccessRow {
  is_owner: boolean;
  highest_position: number;
  permissions: Permission[];
}

@Injectable()
export class PermissionService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Resolves a user's access in a club in one query. Returns null if they are
   * not a member of the club.
   *
   * Pass the request's transaction manager once withTenant() exists, so the
   * lookup runs under the tenant's RLS context.
   */
  async getClubAccess(
    clubId: string,
    userId: string,
    manager: EntityManager = this.dataSource.manager,
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
