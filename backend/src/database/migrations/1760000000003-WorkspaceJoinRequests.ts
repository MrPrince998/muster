import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Discord-style "apply to join": a "request" join policy, a "moderator"
 * workspace role that reviews requests, and the requests themselves (with
 * the same RLS as every other tenant table).
 */
export class WorkspaceJoinRequests1760000000003 implements MigrationInterface {
  name = 'WorkspaceJoinRequests1760000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organisations DROP CONSTRAINT organisations_join_policy`);
    await queryRunner.query(
      `ALTER TABLE organisations ADD CONSTRAINT organisations_join_policy
       CHECK (join_policy IN ('invite', 'request', 'open'))`,
    );

    await queryRunner.query(`ALTER TABLE org_members DROP CONSTRAINT org_members_role`);
    await queryRunner.query(
      `ALTER TABLE org_members ADD CONSTRAINT org_members_role
       CHECK (role IN ('owner', 'admin', 'moderator', 'member'))`,
    );

    await queryRunner.query(`
      CREATE TABLE org_join_requests (
        id         uuid         NOT NULL DEFAULT gen_random_uuid(),
        org_id     uuid         NOT NULL,
        user_id    uuid         NOT NULL,
        status     varchar(20)  NOT NULL DEFAULT 'pending',
        message    varchar(500),
        decided_by uuid,
        decided_at timestamptz,
        created_at timestamptz  NOT NULL DEFAULT now(),
        updated_at timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT org_join_requests_pkey PRIMARY KEY (id),
        CONSTRAINT org_join_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        CONSTRAINT org_join_requests_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
        CONSTRAINT org_join_requests_org_id_fkey FOREIGN KEY (org_id)
          REFERENCES organisations (id) ON DELETE CASCADE,
        CONSTRAINT org_join_requests_user_id_fkey FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT org_join_requests_decided_by_fkey FOREIGN KEY (decided_by)
          REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX org_join_requests_one_pending ON org_join_requests (org_id, user_id) WHERE status = 'pending'`,
    );
    await queryRunner.query(`CREATE INDEX org_join_requests_user_id_idx ON org_join_requests (user_id)`);

    // same isolation as every tenant table (see TenantIsolation)
    await queryRunner.query(`ALTER TABLE org_join_requests ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE org_join_requests FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON org_join_requests
        USING (org_id = current_org_id())
        WITH CHECK (org_id = current_org_id())
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE org_join_requests`);

    // members and workspaces using the new values fall back to the closest old one
    await queryRunner.query(`UPDATE org_members SET role = 'member' WHERE role = 'moderator'`);
    await queryRunner.query(`ALTER TABLE org_members DROP CONSTRAINT org_members_role`);
    await queryRunner.query(
      `ALTER TABLE org_members ADD CONSTRAINT org_members_role CHECK (role IN ('owner', 'admin', 'member'))`,
    );

    await queryRunner.query(`UPDATE organisations SET join_policy = 'invite' WHERE join_policy = 'request'`);
    await queryRunner.query(`ALTER TABLE organisations DROP CONSTRAINT organisations_join_policy`);
    await queryRunner.query(
      `ALTER TABLE organisations ADD CONSTRAINT organisations_join_policy CHECK (join_policy IN ('invite', 'open'))`,
    );
  }
}
