import type { MigrationInterface, QueryRunner } from 'typeorm';

function appRole(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required to grant the app role');
  return decodeURIComponent(new URL(raw).username);
}

// a zone Node knows (the app validates new ones the same way)
function defaultZone(): string {
  const zone = process.env.APP_TIME_ZONE || 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

/**
 * Each workspace keeps its own time zone (an IANA name): events happen where
 * the club is, so emails, reminders, previews and the app show times there.
 * Existing workspaces take APP_TIME_ZONE, which until now applied to all.
 * user_organisations() returns it too, so the app has it from the start.
 */
export class WorkspaceTimeZones1760000000009 implements MigrationInterface {
  name = 'WorkspaceTimeZones1760000000009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organisations ADD COLUMN time_zone varchar(64) NOT NULL DEFAULT 'UTC'`);
    await queryRunner.query(`ALTER TABLE organisations DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`UPDATE organisations SET time_zone = $1`, [defaultZone()]);
    await queryRunner.query(`ALTER TABLE organisations ENABLE ROW LEVEL SECURITY`);

    // a new column in what it returns: replaced, not altered
    await queryRunner.query(`DROP FUNCTION user_organisations(uuid)`);
    await queryRunner.query(`
      CREATE FUNCTION user_organisations(p_user_id uuid)
      RETURNS TABLE (org_id uuid, name varchar, slug varchar, role varchar, joined_at timestamptz, time_zone varchar)
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT o.id, o.name, o.slug, m.role, m.joined_at, o.time_zone
        FROM org_members m
        JOIN organisations o ON o.id = m.org_id
        WHERE m.user_id = p_user_id
        ORDER BY o.name
      $$
    `);
    await queryRunner.query(`REVOKE ALL ON FUNCTION user_organisations(uuid) FROM PUBLIC`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION user_organisations(uuid) TO "${appRole()}"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION user_organisations(uuid)`);
    await queryRunner.query(`
      CREATE FUNCTION user_organisations(p_user_id uuid)
      RETURNS TABLE (org_id uuid, name varchar, slug varchar, role varchar, joined_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT o.id, o.name, o.slug, m.role, m.joined_at
        FROM org_members m JOIN organisations o ON o.id = m.org_id
        WHERE m.user_id = p_user_id ORDER BY o.name
      $$
    `);
    await queryRunner.query(`REVOKE ALL ON FUNCTION user_organisations(uuid) FROM PUBLIC`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION user_organisations(uuid) TO "${appRole()}"`);
    await queryRunner.query(`ALTER TABLE organisations DROP COLUMN time_zone`);
  }
}
