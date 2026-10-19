import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Messages from organisers to the people going to an event ("The room has
 * changed", "Bring a laptop"). Kept, so organisers see what's been said
 * already and to how many. Tenant-scoped with forced RLS.
 */
export class EventMessages1760000000016 implements MigrationInterface {
  name = 'EventMessages1760000000016';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE event_messages (
        id               uuid          NOT NULL DEFAULT gen_random_uuid(),
        org_id           uuid          NOT NULL,
        event_id         uuid          NOT NULL,
        sender_id        uuid,
        subject          varchar(150)  NOT NULL,
        body             varchar(5000) NOT NULL,
        -- the waitlist got it too
        to_waitlist      boolean       NOT NULL DEFAULT false,
        recipient_count  integer       NOT NULL,
        created_at       timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT event_messages_pkey PRIMARY KEY (id),
        CONSTRAINT event_messages_event_fkey FOREIGN KEY (event_id, org_id) REFERENCES events (id, org_id) ON DELETE CASCADE,
        CONSTRAINT event_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX event_messages_event_id_created_at_idx ON event_messages (event_id, created_at)`);
    await queryRunner.query(`ALTER TABLE event_messages ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE event_messages FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON event_messages
        USING (org_id = current_org_id())
        WITH CHECK (org_id = current_org_id())
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE event_messages`);
  }
}
