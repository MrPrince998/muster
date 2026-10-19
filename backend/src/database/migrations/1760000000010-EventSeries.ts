import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recurring events: a series is the events made together from one "repeats
 * weekly, 8 times". Each occurrence stays a full event of its own (its own
 * places, tickets, check-in and history); the series only ties them together,
 * so "this and following" can edit or cancel the rest at once. No table of
 * its own: an id shared by its events, and the rule, for showing.
 */
export class EventSeries1760000000010 implements MigrationInterface {
  name = 'EventSeries1760000000010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE events
        ADD COLUMN series_id    uuid,
        ADD COLUMN repeat_every text,
        ADD CONSTRAINT events_repeat_every_check CHECK (repeat_every IN ('week', 'fortnight', 'month')),
        ADD CONSTRAINT events_series_check CHECK ((series_id IS NULL) = (repeat_every IS NULL))
    `);
    // a series in order, for "this and following" and "3 of 8"
    await queryRunner.query(`CREATE INDEX events_series_idx ON events (series_id, starts_at) WHERE series_id IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX events_series_idx`);
    await queryRunner.query(`
      ALTER TABLE events
        DROP CONSTRAINT events_series_check,
        DROP CONSTRAINT events_repeat_every_check,
        DROP COLUMN repeat_every,
        DROP COLUMN series_id
    `);
  }
}
