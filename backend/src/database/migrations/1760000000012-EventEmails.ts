import type { MigrationInterface, QueryRunner } from 'typeorm';

function appRole(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required to grant the app role');
  return decodeURIComponent(new URL(raw).username);
}

/**
 * New-event emails. Each member chooses, per club: none (the default), one
 * as each event is published, or a weekly digest. An event is announced
 * once (announced_at, claimed like reminders), and each person gets one
 * digest a week per workspace (digest_sent_at). Finding the workspaces with
 * something due spans every tenant, which RLS forbids the app; two
 * SECURITY DEFINER functions answer with workspace ids only.
 */
export class EventEmails1760000000012 implements MigrationInterface {
  name = 'EventEmails1760000000012';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE club_members
        ADD COLUMN event_emails varchar(10) NOT NULL DEFAULT 'off',
        ADD CONSTRAINT club_members_event_emails_check CHECK (event_emails IN ('off', 'instant', 'weekly'))
    `);
    await queryRunner.query(`ALTER TABLE org_members ADD COLUMN digest_sent_at timestamptz`);
    await queryRunner.query(`ALTER TABLE events ADD COLUMN announced_at timestamptz`);
    // what's already published was news before this existed: nobody chose emails for it
    await queryRunner.query(`UPDATE events SET announced_at = now() WHERE status <> 'draft'`);
    await queryRunner.query(
      `CREATE INDEX events_unannounced_idx ON events (org_id) WHERE status = 'published' AND announced_at IS NULL`,
    );

    await queryRunner.query(`
      CREATE FUNCTION due_announcement_organisations()
      RETURNS SETOF uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT DISTINCT org_id FROM events WHERE status = 'published' AND announced_at IS NULL
      $$
    `);
    // Monday from 08:00 on the workspace's clock (any day when p_any_day: tests), for
    // anyone choosing a weekly digest who hasn't had one in six days
    await queryRunner.query(`
      CREATE FUNCTION due_digest_organisations(p_any_day boolean)
      RETURNS SETOF uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT DISTINCT o.id
        FROM organisations o
        JOIN org_members om ON om.org_id = o.id
        JOIN club_members cm ON cm.org_id = om.org_id AND cm.user_id = om.user_id AND cm.event_emails = 'weekly'
        WHERE (om.digest_sent_at IS NULL OR om.digest_sent_at < now() - interval '6 days')
          AND (p_any_day OR (extract(isodow FROM now() AT TIME ZONE o.time_zone) = 1
                             AND extract(hour FROM now() AT TIME ZONE o.time_zone) >= 8))
      $$
    `);
    for (const fn of ['due_announcement_organisations()', 'due_digest_organisations(boolean)']) {
      await queryRunner.query(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`);
      await queryRunner.query(`GRANT EXECUTE ON FUNCTION ${fn} TO "${appRole()}"`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION due_digest_organisations(boolean)`);
    await queryRunner.query(`DROP FUNCTION due_announcement_organisations()`);
    await queryRunner.query(`DROP INDEX events_unannounced_idx`);
    await queryRunner.query(`ALTER TABLE events DROP COLUMN announced_at`);
    await queryRunner.query(`ALTER TABLE org_members DROP COLUMN digest_sent_at`);
    await queryRunner.query(`
      ALTER TABLE club_members
        DROP CONSTRAINT club_members_event_emails_check,
        DROP COLUMN event_emails
    `);
  }
}
