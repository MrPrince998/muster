import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The rest of an event's life after publishing: closing registration early,
 * and cancelling (when, and the note sent to the people registered).
 */
export class EventLifecycle1760000000004 implements MigrationInterface {
  name = 'EventLifecycle1760000000004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE events
        ADD COLUMN registration_closed_at timestamptz,
        ADD COLUMN cancelled_at timestamptz,
        ADD COLUMN cancel_reason varchar(500)
    `);
    // events cancelled before this column existed get their last update as the time
    await queryRunner.query(`UPDATE events SET cancelled_at = updated_at WHERE status = 'cancelled'`);
    await queryRunner.query(`
      ALTER TABLE events
        ADD CONSTRAINT events_cancelled_at CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
        ADD CONSTRAINT events_cancel_reason CHECK (cancel_reason IS NULL OR status = 'cancelled')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE events
        DROP CONSTRAINT events_cancel_reason,
        DROP CONSTRAINT events_cancelled_at,
        DROP COLUMN cancel_reason,
        DROP COLUMN cancelled_at,
        DROP COLUMN registration_closed_at
    `);
  }
}
