import type { MigrationInterface, QueryRunner } from 'typeorm';

/** An event's cover image: where its file is kept (files module); null for none. */
export class CoverImages1760000000019 implements MigrationInterface {
  name = 'CoverImages1760000000019';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE events ADD COLUMN cover_image_key varchar(200)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE events DROP COLUMN cover_image_key`);
  }
}
