import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Questions an event asks the people taking a place (dietary needs, T-shirt
 * size): up to five per event, kept on the event; the answers go with the
 * place, on the waitlist entry or checkout until it becomes one.
 */
export class RegistrationQuestions1760000000017 implements MigrationInterface {
  name = 'RegistrationQuestions1760000000017';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE events ADD COLUMN questions jsonb NOT NULL DEFAULT '[]'`);
    for (const table of ['registrations', 'waitlist_entries', 'checkouts']) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN answers jsonb NOT NULL DEFAULT '{}'`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['checkouts', 'waitlist_entries', 'registrations']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN answers`);
    }
    await queryRunner.query(`ALTER TABLE events DROP COLUMN questions`);
  }
}
