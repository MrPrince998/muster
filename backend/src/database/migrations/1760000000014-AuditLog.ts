import type { MigrationInterface, QueryRunner } from 'typeorm';

function appRole(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required to grant the app role');
  return decodeURIComponent(new URL(raw).username);
}

/**
 * The audit log: who changed what in a workspace (roles, members, events,
 * invites, settings, exports). Written in the same transaction as the change,
 * so neither exists without the other. Append-only: the app may add and read
 * entries, never change or remove them (deleting the workspace removes its
 * log, through the foreign key). Tenant-scoped with forced RLS.
 */
export class AuditLog1760000000014 implements MigrationInterface {
  name = 'AuditLog1760000000014';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id              uuid        NOT NULL DEFAULT gen_random_uuid(),
        org_id          uuid        NOT NULL,
        -- who did it; null once their account is deleted
        actor_id        uuid,
        action          varchar(50) NOT NULL,
        club_id         uuid,
        event_id        uuid,
        -- the person it was done to, if any
        subject_user_id uuid,
        -- what it was, as it was then (titles and role names can change or go)
        details         jsonb       NOT NULL DEFAULT '{}',
        created_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT audit_log_pkey PRIMARY KEY (id),
        CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
        CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT audit_log_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    // newest first, per workspace and per club
    await queryRunner.query(`CREATE INDEX audit_log_org_id_created_at_idx ON audit_log (org_id, created_at DESC, id DESC)`);
    await queryRunner.query(`CREATE INDEX audit_log_club_id_created_at_idx ON audit_log (club_id, created_at DESC)`);
    await queryRunner.query(`ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE audit_log FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON audit_log
        USING (org_id = current_org_id())
        WITH CHECK (org_id = current_org_id())
    `);
    // append-only for the app (cascades from deleting a workspace run as the owner)
    await queryRunner.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM "${appRole()}"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE audit_log`);
  }
}
