import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refresh-token sessions and single-use email links (verification, password
 * reset). Neither is tenant data, so no RLS. The app role gets access through
 * the default privileges set in TenantIsolation.
 */
export class AuthTokens1760000000002 implements MigrationInterface {
  name = 'AuthTokens1760000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sessions (
        id                  uuid         NOT NULL DEFAULT gen_random_uuid(),
        user_id             uuid         NOT NULL,
        token_hash          varchar(64)  NOT NULL,
        previous_token_hash varchar(64),
        expires_at          timestamptz  NOT NULL,
        last_used_at        timestamptz  NOT NULL DEFAULT now(),
        revoked_at          timestamptz,
        user_agent          varchar(512),
        ip                  inet,
        created_at          timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT sessions_pkey PRIMARY KEY (id),
        CONSTRAINT sessions_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT sessions_previous_token_hash_format CHECK (
          previous_token_hash IS NULL OR previous_token_hash ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT sessions_expires_after_created CHECK (expires_at > created_at),
        CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash)`);
    await queryRunner.query(`CREATE INDEX sessions_user_id_idx ON sessions (user_id)`);
    await queryRunner.query(
      `CREATE INDEX sessions_previous_token_hash_idx ON sessions (previous_token_hash)`,
    );

    await queryRunner.query(`
      CREATE TABLE email_tokens (
        id         uuid         NOT NULL DEFAULT gen_random_uuid(),
        user_id    uuid         NOT NULL,
        purpose    varchar(30)  NOT NULL,
        token_hash varchar(64)  NOT NULL,
        email      varchar(320) NOT NULL,
        expires_at timestamptz  NOT NULL,
        used_at    timestamptz,
        created_at timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT email_tokens_pkey PRIMARY KEY (id),
        CONSTRAINT email_tokens_purpose CHECK (purpose IN ('verify_email', 'reset_password')),
        CONSTRAINT email_tokens_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT email_tokens_expires_after_created CHECK (expires_at > created_at),
        CONSTRAINT email_tokens_user_id_fkey FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX email_tokens_token_hash_key ON email_tokens (token_hash)`);
    await queryRunner.query(
      `CREATE INDEX email_tokens_user_id_purpose_unused_idx ON email_tokens (user_id, purpose) WHERE used_at IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_tokens`);
    await queryRunner.query(`DROP TABLE sessions`);
  }
}
