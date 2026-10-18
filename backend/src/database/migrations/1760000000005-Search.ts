import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Search (the ⌘K box): trigram matching, so "robo" finds "Robotics Society"
 * and "robtics" still does, with indexes on everything searched.
 */
export class Search1760000000005 implements MigrationInterface {
  name = 'Search1760000000005';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`CREATE INDEX clubs_name_trgm_idx ON clubs USING gin (name gin_trgm_ops)`);
    await queryRunner.query(`CREATE INDEX events_title_trgm_idx ON events USING gin (title gin_trgm_ops)`);
    await queryRunner.query(`CREATE INDEX users_name_trgm_idx ON users USING gin (name gin_trgm_ops)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX users_name_trgm_idx`);
    await queryRunner.query(`DROP INDEX events_title_trgm_idx`);
    await queryRunner.query(`DROP INDEX clubs_name_trgm_idx`);
    // the extension stays: other objects may use it by then
  }
}
