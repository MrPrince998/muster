import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Waitlists for full events. A separate table rather than a kind of
 * registration: every count of places, attendee list, ticket and check-in
 * reads registrations, and none of them should ever see someone who's only
 * waiting. Tenant-scoped with the same forced RLS as every other tenant table.
 */
export class Waitlist1760000000008 implements MigrationInterface {
  name = 'Waitlist1760000000008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE waitlist_entries (
        id          uuid        NOT NULL DEFAULT gen_random_uuid(),
        org_id      uuid        NOT NULL,
        event_id    uuid        NOT NULL,
        user_id     uuid        NOT NULL,
        -- the queue's order: first in, first given a place
        created_at  timestamptz NOT NULL DEFAULT now(),
        -- given a place (kept, so the history shows who came off the waitlist)
        promoted_at timestamptz,
        CONSTRAINT waitlist_entries_pkey PRIMARY KEY (id),
        CONSTRAINT waitlist_entries_event_fkey FOREIGN KEY (event_id, org_id)
          REFERENCES events (id, org_id) ON DELETE CASCADE,
        CONSTRAINT waitlist_entries_user_id_fkey FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE
      )
    `);
    // once in the queue at a time; the queue in order, per event
    await queryRunner.query(
      `CREATE UNIQUE INDEX waitlist_entries_waiting_key ON waitlist_entries (event_id, user_id) WHERE promoted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX waitlist_entries_queue_idx ON waitlist_entries (event_id, created_at) WHERE promoted_at IS NULL`,
    );

    await queryRunner.query(`ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE waitlist_entries FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON waitlist_entries
        USING (org_id = current_org_id())
        WITH CHECK (org_id = current_org_id())
    `);
    // the app role's grants come from the default privileges set in TenantIsolation
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE waitlist_entries`);
  }
}
