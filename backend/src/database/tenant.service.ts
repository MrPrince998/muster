import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource, type EntityManager } from 'typeorm';

export interface UserOrganisation {
  orgId: string;
  name: string;
  slug: string;
  role: string;
  joinedAt: Date;
}

/**
 * The only way to touch tenant data. RLS returns no rows from a tenant table
 * unless app.current_org_id is set, and withTenant() is what sets it.
 */
@Injectable()
export class TenantService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Runs `work` in a transaction scoped to one organisation. Every query in
   * it must go through the given manager:
   *
   *   await this.tenant.withTenant(orgId, (m) => m.getRepository(Club).find());
   *
   * The setting is transaction-local (set_config(..., true) is SET LOCAL), so
   * it ends with the transaction and can never leak to the next request that
   * reuses the pooled connection.
   */
  async withTenant<T>(orgId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    // set_config would accept any text; a bad value must fail here, loudly,
    // rather than as a cast error inside a policy
    if (!isUUID(orgId)) {
      throw new Error(`withTenant() needs an org id (uuid), got "${orgId}"`);
    }
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
      return work(manager);
    });
  }

  // --- resolving the tenant before withTenant() --------------------------------
  // Each returns null when nothing matches. They run outside any tenant and see
  // through RLS (SECURITY DEFINER), so they return ids only.

  orgIdForSlug(slug: string): Promise<string | null> {
    return this.resolve('org_id_for_slug($1)', slug);
  }

  orgIdForClub(clubId: string): Promise<string | null> {
    return isUUID(clubId) ? this.resolve('org_id_for_club($1)', clubId) : Promise.resolve(null);
  }

  orgIdForEvent(eventId: string): Promise<string | null> {
    return isUUID(eventId) ? this.resolve('org_id_for_event($1)', eventId) : Promise.resolve(null);
  }

  orgIdForInviteCode(code: string): Promise<string | null> {
    return this.resolve('org_id_for_invite_code($1)', code);
  }

  /** The workspaces a user belongs to ("my workspaces"), across all tenants. */
  async userOrganisations(userId: string): Promise<UserOrganisation[]> {
    const rows: {
      org_id: string;
      name: string;
      slug: string;
      role: string;
      joined_at: Date;
    }[] = await this.dataSource.query(`SELECT * FROM user_organisations($1)`, [userId]);
    return rows.map((r) => ({
      orgId: r.org_id,
      name: r.name,
      slug: r.slug,
      role: r.role,
      joinedAt: r.joined_at,
    }));
  }

  private async resolve(call: string, arg: string): Promise<string | null> {
    const rows: { org_id: string | null }[] = await this.dataSource.query(
      `SELECT ${call} AS org_id`,
      [arg],
    );
    return rows[0]?.org_id ?? null;
  }
}
