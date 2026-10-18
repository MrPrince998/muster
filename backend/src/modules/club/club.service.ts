import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DEFAULT_ROLES, OWNER_ROLE_POSITION } from '../permission/permissions.js';

export interface NewClub {
  orgId: string;
  name: string;
  slug: string;
  description?: string | null;
  isDefault?: boolean;
  // becomes a member holding the Owner role
  ownerId: string;
}

@Injectable()
export class ClubService {
  /**
   * Creates a club with its Owner role and the default roles, and makes
   * `ownerId` its first member, holding Owner. Runs inside the caller's
   * withTenant() transaction, so a failure anywhere leaves nothing behind.
   * The owner must already be a member of the workspace.
   */
  async provision(m: EntityManager, club: NewClub): Promise<{ clubId: string; ownerRoleId: string }> {
    const [{ id: clubId }]: { id: string }[] = await m.query(
      `INSERT INTO clubs (org_id, name, slug, description, is_default)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [club.orgId, club.name, club.slug, club.description ?? null, club.isDefault ?? false],
    );

    const [{ id: ownerRoleId }]: { id: string }[] = await m.query(
      `INSERT INTO roles (org_id, club_id, name, position, is_owner)
       VALUES ($1, $2, 'Owner', $3, true) RETURNING id`,
      [club.orgId, clubId, OWNER_ROLE_POSITION],
    );
    for (const role of DEFAULT_ROLES) {
      await m.query(
        `INSERT INTO roles (org_id, club_id, name, position, permissions) VALUES ($1, $2, $3, $4, $5)`,
        [club.orgId, clubId, role.name, role.position, role.permissions],
      );
    }

    await m.query(`INSERT INTO club_members (club_id, user_id, org_id) VALUES ($1, $2, $3)`, [
      clubId,
      club.ownerId,
      club.orgId,
    ]);
    await m.query(
      `INSERT INTO member_roles (club_id, user_id, role_id, org_id) VALUES ($1, $2, $3, $4)`,
      [clubId, club.ownerId, ownerRoleId, club.orgId],
    );

    return { clubId, ownerRoleId };
  }
}
