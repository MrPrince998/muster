import type { MigrationInterface, QueryRunner } from 'typeorm';

function appRole(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required to grant the app role');
  return decodeURIComponent(new URL(raw).username);
}

/**
 * "How was it?": after an event, everyone who came in is asked once
 * (registrations.feedback_requested_at), and answers with a rating and an
 * optional comment, one per place, changeable. Organisers see the answers
 * without names. Tenant-scoped with forced RLS like every tenant table;
 * finding the workspaces with requests due spans tenants, so a SECURITY
 * DEFINER function answers with workspace ids only.
 */
export class EventFeedback1760000000013 implements MigrationInterface {
  name = 'EventFeedback1760000000013';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE event_feedback (
        id              uuid          NOT NULL DEFAULT gen_random_uuid(),
        org_id          uuid          NOT NULL,
        event_id        uuid          NOT NULL,
        registration_id uuid          NOT NULL,
        rating          smallint      NOT NULL,
        comment         varchar(1000),
        created_at      timestamptz   NOT NULL DEFAULT now(),
        updated_at      timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT event_feedback_pkey PRIMARY KEY (id),
        CONSTRAINT event_feedback_registration_id_key UNIQUE (registration_id),
        CONSTRAINT event_feedback_rating_check CHECK (rating BETWEEN 1 AND 5),
        CONSTRAINT event_feedback_event_fkey FOREIGN KEY (event_id, org_id)
          REFERENCES events (id, org_id) ON DELETE CASCADE,
        CONSTRAINT event_feedback_registration_fkey FOREIGN KEY (registration_id)
          REFERENCES registrations (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX event_feedback_event_id_idx ON event_feedback (event_id)`);
    await queryRunner.query(`ALTER TABLE event_feedback ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE event_feedback FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON event_feedback
        USING (org_id = current_org_id())
        WITH CHECK (org_id = current_org_id())
    `);

    await queryRunner.query(`ALTER TABLE registrations ADD COLUMN feedback_requested_at timestamptz`);
    // past events aren't asked about after the fact
    await queryRunner.query(`
      UPDATE registrations r SET feedback_requested_at = now()
      FROM events e WHERE e.id = r.event_id AND e.ends_at <= now()
    `);

    // events that ended between p_after and p_within ago, with people who came in and weren't asked
    await queryRunner.query(`
      CREATE FUNCTION due_feedback_organisations(p_after interval, p_within interval)
      RETURNS SETOF uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT DISTINCT e.org_id
        FROM events e JOIN registrations r ON r.event_id = e.id
        WHERE e.status = 'published'
          AND e.ends_at <= now() - p_after AND e.ends_at > now() - p_within
          AND r.checked_in_at IS NOT NULL AND r.cancelled_at IS NULL AND r.feedback_requested_at IS NULL
      $$
    `);
    await queryRunner.query(`REVOKE ALL ON FUNCTION due_feedback_organisations(interval, interval) FROM PUBLIC`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION due_feedback_organisations(interval, interval) TO "${appRole()}"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION due_feedback_organisations(interval, interval)`);
    await queryRunner.query(`ALTER TABLE registrations DROP COLUMN feedback_requested_at`);
    await queryRunner.query(`DROP TABLE event_feedback`);
  }
}
