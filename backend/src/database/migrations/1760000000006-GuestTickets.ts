import type { MigrationInterface, QueryRunner } from 'typeorm';

// the app's role, as in TenantIsolation: whoever DATABASE_URL connects as
function appRole(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required to grant the app role');
  return decodeURIComponent(new URL(raw).username);
}

/**
 * Tickets outside your workspaces. A guest at a public event (or someone who
 * registered from its public page) holds a ticket in a workspace they don't
 * belong to; once they have an account, My tickets has to find it. Like the
 * other tenant lookups, this answers only "which workspaces?" for one user
 * (the caller passes the authenticated user's id) and returns ids, never data.
 */
export class GuestTickets1760000000006 implements MigrationInterface {
  name = 'GuestTickets1760000000006';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION user_ticket_organisations(p_user_id uuid)
      RETURNS SETOF uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT DISTINCT org_id FROM registrations WHERE user_id = p_user_id AND cancelled_at IS NULL
      $$
    `);
    await queryRunner.query(`REVOKE ALL ON FUNCTION user_ticket_organisations(uuid) FROM PUBLIC`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION user_ticket_organisations(uuid) TO "${appRole()}"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION user_ticket_organisations(uuid)`);
  }
}
