import type { MigrationInterface, QueryRunner } from 'typeorm';

function appRole(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required to grant the app role');
  return decodeURIComponent(new URL(raw).username);
}

/**
 * Reminder emails the day before an event. Each registration records when
 * its reminder went out, so it goes out once, however many copies of the API
 * run the job. Finding them spans every workspace, which RLS forbids the app;
 * like the other tenant lookups, a SECURITY DEFINER function answers only
 * "which workspaces have reminders due?" with ids, and each is then handled
 * under its own tenant.
 */
export class EventReminders1760000000007 implements MigrationInterface {
  name = 'EventReminders1760000000007';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE registrations ADD COLUMN reminder_sent_at timestamptz`);
    // the job scans published events by start time
    await queryRunner.query(
      `CREATE INDEX events_starts_at_published_idx ON events (starts_at) WHERE status = 'published'`,
    );
    // p_within: how far ahead a reminder is due; p_min_ahead: too close to bother;
    // a place taken less than p_within before the start already got its ticket email
    await queryRunner.query(`
      CREATE FUNCTION due_reminder_organisations(p_within interval, p_min_ahead interval)
      RETURNS SETOF uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT DISTINCT e.org_id
        FROM events e
        JOIN registrations r ON r.event_id = e.id
        WHERE e.status = 'published'
          AND e.starts_at > now() + p_min_ahead
          AND e.starts_at <= now() + p_within
          AND r.cancelled_at IS NULL AND r.checked_in_at IS NULL AND r.reminder_sent_at IS NULL
          AND r.created_at <= e.starts_at - p_within
      $$
    `);
    await queryRunner.query(`REVOKE ALL ON FUNCTION due_reminder_organisations(interval, interval) FROM PUBLIC`);
    await queryRunner.query(
      `GRANT EXECUTE ON FUNCTION due_reminder_organisations(interval, interval) TO "${appRole()}"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION due_reminder_organisations(interval, interval)`);
    await queryRunner.query(`DROP INDEX events_starts_at_published_idx`);
    await queryRunner.query(`ALTER TABLE registrations DROP COLUMN reminder_sent_at`);
  }
}
