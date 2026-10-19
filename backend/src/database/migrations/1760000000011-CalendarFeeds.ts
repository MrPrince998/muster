import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Calendar feeds: a private link a calendar app subscribes to. The link is
 * derived from the user and this number (an HMAC, nothing stored); resetting
 * the link bumps the number, so every old link stops working at once.
 */
export class CalendarFeeds1760000000011 implements MigrationInterface {
  name = 'CalendarFeeds1760000000011';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN calendar_feed_version integer NOT NULL DEFAULT 0`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN calendar_feed_version`);
  }
}
