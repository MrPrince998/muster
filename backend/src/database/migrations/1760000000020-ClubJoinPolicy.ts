import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Each club decides who can join it, as a workspace does: anyone in the
 * workspace (open), by asking (request: the club's approvers decide), or
 * only with an invite link (invite, as every club was until now). Asking
 * needs no link, so a join request's invite becomes optional, and it can
 * carry a note.
 */
export class ClubJoinPolicy1760000000020 implements MigrationInterface {
  name = 'ClubJoinPolicy1760000000020';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clubs
        ADD COLUMN join_policy varchar(20) NOT NULL DEFAULT 'invite',
        ADD CONSTRAINT clubs_join_policy_check CHECK (join_policy IN ('open', 'request', 'invite'))
    `);
    await queryRunner.query(`ALTER TABLE join_requests ALTER COLUMN invite_id DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE join_requests ADD COLUMN message varchar(500)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE join_requests DROP COLUMN message`);
    await queryRunner.query(`DELETE FROM join_requests WHERE invite_id IS NULL`);
    await queryRunner.query(`ALTER TABLE join_requests ALTER COLUMN invite_id SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE clubs DROP CONSTRAINT clubs_join_policy_check, DROP COLUMN join_policy`);
  }
}
