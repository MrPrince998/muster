import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every table from the data model, in dependency order. Mirrors the entities
 * exactly (`pnpm migration:check` fails if they drift apart). Tenant
 * isolation is added in the next migration.
 */
export class InitialSchema1760000000000 implements MigrationInterface {
  name = 'InitialSchema1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built into Postgres 13+, so no extension is needed

    await queryRunner.query(`
      CREATE TABLE users (
        id                uuid         NOT NULL DEFAULT gen_random_uuid(),
        email             varchar(320) NOT NULL,
        name              varchar(100) NOT NULL,
        password_hash     varchar(255),
        email_verified_at timestamptz,
        last_login_at     timestamptz,
        created_at        timestamptz  NOT NULL DEFAULT now(),
        updated_at        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT users_pkey PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX users_email_key ON users (email)`);

    await queryRunner.query(`
      CREATE TABLE organisations (
        id          uuid         NOT NULL DEFAULT gen_random_uuid(),
        name        varchar(100) NOT NULL,
        slug        varchar(50)  NOT NULL,
        join_policy varchar(20)  NOT NULL DEFAULT 'invite',
        created_at  timestamptz  NOT NULL DEFAULT now(),
        updated_at  timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT organisations_pkey PRIMARY KEY (id),
        CONSTRAINT organisations_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT organisations_join_policy CHECK (join_policy IN ('invite', 'open'))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX organisations_slug_key ON organisations (slug)`);

    await queryRunner.query(`
      CREATE TABLE org_members (
        org_id     uuid        NOT NULL,
        user_id    uuid        NOT NULL,
        role       varchar(20) NOT NULL DEFAULT 'member',
        joined_at  timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT org_members_pkey PRIMARY KEY (org_id, user_id),
        CONSTRAINT org_members_role CHECK (role IN ('owner', 'admin', 'member')),
        CONSTRAINT org_members_org_id_fkey FOREIGN KEY (org_id)
          REFERENCES organisations (id) ON DELETE CASCADE,
        CONSTRAINT org_members_user_id_fkey FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX org_members_user_id_idx ON org_members (user_id)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX org_members_one_owner ON org_members (org_id) WHERE role = 'owner'`,
    );

    await queryRunner.query(`
      CREATE TABLE clubs (
        id          uuid         NOT NULL DEFAULT gen_random_uuid(),
        org_id      uuid         NOT NULL,
        name        varchar(100) NOT NULL,
        slug        varchar(50)  NOT NULL,
        description text,
        is_default  boolean      NOT NULL DEFAULT false,
        created_at  timestamptz  NOT NULL DEFAULT now(),
        updated_at  timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT clubs_pkey PRIMARY KEY (id),
        CONSTRAINT clubs_id_org_id_key UNIQUE (id, org_id),
        CONSTRAINT clubs_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT clubs_org_id_fkey FOREIGN KEY (org_id)
          REFERENCES organisations (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX clubs_org_id_slug_key ON clubs (org_id, slug)`);
    await queryRunner.query(`CREATE UNIQUE INDEX clubs_one_default ON clubs (org_id) WHERE is_default`);

    await queryRunner.query(`
      CREATE TABLE club_members (
        club_id   uuid        NOT NULL,
        user_id   uuid        NOT NULL,
        org_id    uuid        NOT NULL,
        joined_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT club_members_pkey PRIMARY KEY (club_id, user_id),
        CONSTRAINT club_members_club_fkey FOREIGN KEY (club_id, org_id)
          REFERENCES clubs (id, org_id) ON DELETE CASCADE,
        CONSTRAINT club_members_org_member_fkey FOREIGN KEY (org_id, user_id)
          REFERENCES org_members (org_id, user_id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX club_members_org_id_user_id_idx ON club_members (org_id, user_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE roles (
        id          uuid        NOT NULL DEFAULT gen_random_uuid(),
        org_id      uuid        NOT NULL,
        club_id     uuid        NOT NULL,
        name        varchar(50) NOT NULL,
        position    integer     NOT NULL,
        permissions text[]      NOT NULL DEFAULT '{}',
        is_owner    boolean     NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT roles_pkey PRIMARY KEY (id),
        CONSTRAINT roles_club_id_name_key UNIQUE (club_id, name),
        CONSTRAINT roles_club_id_position_key UNIQUE (club_id, position) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT roles_id_club_id_org_id_key UNIQUE (id, club_id, org_id),
        CONSTRAINT roles_permissions_valid CHECK (permissions <@ ARRAY[
          'event.create', 'event.publish', 'event.manage_own', 'event.manage_any',
          'registration.view', 'checkin.scan', 'analytics.view', 'member.approve',
          'member.remove', 'invite.manage', 'role.manage'
        ]::text[]),
        CONSTRAINT roles_position_positive CHECK (position > 0),
        CONSTRAINT roles_club_fkey FOREIGN KEY (club_id, org_id)
          REFERENCES clubs (id, org_id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX roles_one_owner ON roles (club_id) WHERE is_owner`);

    await queryRunner.query(`
      CREATE TABLE member_roles (
        club_id     uuid        NOT NULL,
        user_id     uuid        NOT NULL,
        role_id     uuid        NOT NULL,
        org_id      uuid        NOT NULL,
        assigned_by uuid,
        assigned_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT member_roles_pkey PRIMARY KEY (club_id, user_id, role_id),
        CONSTRAINT member_roles_club_member_fkey FOREIGN KEY (club_id, user_id)
          REFERENCES club_members (club_id, user_id) ON DELETE CASCADE,
        CONSTRAINT member_roles_role_fkey FOREIGN KEY (role_id, club_id, org_id)
          REFERENCES roles (id, club_id, org_id) ON DELETE CASCADE,
        CONSTRAINT member_roles_assigned_by_fkey FOREIGN KEY (assigned_by)
          REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX member_roles_role_id_idx ON member_roles (role_id)`);

    await queryRunner.query(`
      CREATE TABLE invites (
        id                uuid        NOT NULL DEFAULT gen_random_uuid(),
        org_id            uuid        NOT NULL,
        club_id           uuid        NOT NULL,
        code              varchar(64) NOT NULL,
        default_role_id   uuid,
        requires_approval boolean     NOT NULL DEFAULT false,
        max_uses          integer,
        use_count         integer     NOT NULL DEFAULT 0,
        expires_at        timestamptz,
        revoked_at        timestamptz,
        created_by        uuid,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT invites_pkey PRIMARY KEY (id),
        CONSTRAINT invites_id_club_id_org_id_key UNIQUE (id, club_id, org_id),
        CONSTRAINT invites_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
        CONSTRAINT invites_use_count_in_range CHECK (
          use_count >= 0 AND (max_uses IS NULL OR use_count <= max_uses)
        ),
        CONSTRAINT invites_club_fkey FOREIGN KEY (club_id, org_id)
          REFERENCES clubs (id, org_id) ON DELETE CASCADE,
        CONSTRAINT invites_default_role_fkey FOREIGN KEY (default_role_id, club_id, org_id)
          REFERENCES roles (id, club_id, org_id),
        CONSTRAINT invites_created_by_fkey FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX invites_code_key ON invites (code)`);
    await queryRunner.query(`CREATE INDEX invites_club_id_idx ON invites (club_id)`);

    await queryRunner.query(`
      CREATE TABLE join_requests (
        id         uuid        NOT NULL DEFAULT gen_random_uuid(),
        org_id     uuid        NOT NULL,
        club_id    uuid        NOT NULL,
        invite_id  uuid        NOT NULL,
        user_id    uuid        NOT NULL,
        status     varchar(20) NOT NULL DEFAULT 'pending',
        decided_by uuid,
        decided_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT join_requests_pkey PRIMARY KEY (id),
        CONSTRAINT join_requests_status CHECK (status IN ('pending', 'approved', 'rejected')),
        CONSTRAINT join_requests_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
        CONSTRAINT join_requests_invite_fkey FOREIGN KEY (invite_id, club_id, org_id)
          REFERENCES invites (id, club_id, org_id) ON DELETE CASCADE,
        CONSTRAINT join_requests_user_id_fkey FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT join_requests_decided_by_fkey FOREIGN KEY (decided_by)
          REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX join_requests_one_pending ON join_requests (club_id, user_id) WHERE status = 'pending'`,
    );
    await queryRunner.query(`CREATE INDEX join_requests_user_id_idx ON join_requests (user_id)`);

    await queryRunner.query(`
      CREATE TABLE events (
        id           uuid         NOT NULL DEFAULT gen_random_uuid(),
        org_id       uuid         NOT NULL,
        club_id      uuid         NOT NULL,
        created_by   uuid,
        title        varchar(200) NOT NULL,
        description  text,
        location     varchar(255),
        starts_at    timestamptz  NOT NULL,
        ends_at      timestamptz  NOT NULL,
        capacity     integer,
        visibility   varchar(20)  NOT NULL DEFAULT 'members',
        status       varchar(20)  NOT NULL DEFAULT 'draft',
        published_at timestamptz,
        created_at   timestamptz  NOT NULL DEFAULT now(),
        updated_at   timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT events_pkey PRIMARY KEY (id),
        CONSTRAINT events_id_org_id_key UNIQUE (id, org_id),
        CONSTRAINT events_visibility CHECK (visibility IN ('members', 'public')),
        CONSTRAINT events_status CHECK (status IN ('draft', 'published', 'cancelled')),
        CONSTRAINT events_ends_after_start CHECK (ends_at > starts_at),
        CONSTRAINT events_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
        CONSTRAINT events_published_at CHECK (status = 'draft' OR published_at IS NOT NULL),
        CONSTRAINT events_club_fkey FOREIGN KEY (club_id, org_id)
          REFERENCES clubs (id, org_id) ON DELETE CASCADE,
        CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX events_club_id_starts_at_idx ON events (club_id, starts_at)`);
    await queryRunner.query(`CREATE INDEX events_created_by_idx ON events (created_by)`);

    await queryRunner.query(`
      CREATE TABLE registrations (
        id            uuid        NOT NULL DEFAULT gen_random_uuid(),
        org_id        uuid        NOT NULL,
        event_id      uuid        NOT NULL,
        user_id       uuid        NOT NULL,
        checked_in_at timestamptz,
        checked_in_by uuid,
        cancelled_at  timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT registrations_pkey PRIMARY KEY (id),
        CONSTRAINT registrations_event_id_user_id_key UNIQUE (event_id, user_id),
        CONSTRAINT registrations_cancelled_or_checked_in CHECK (
          cancelled_at IS NULL OR checked_in_at IS NULL
        ),
        CONSTRAINT registrations_event_fkey FOREIGN KEY (event_id, org_id)
          REFERENCES events (id, org_id) ON DELETE CASCADE,
        CONSTRAINT registrations_user_id_fkey FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT registrations_checked_in_by_fkey FOREIGN KEY (checked_in_by)
          REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX registrations_user_id_idx ON registrations (user_id)`);
    await queryRunner.query(
      `CREATE INDEX registrations_event_id_active_idx ON registrations (event_id) WHERE cancelled_at IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // reverse dependency order
    for (const table of [
      'registrations',
      'events',
      'join_requests',
      'invites',
      'member_roles',
      'roles',
      'club_members',
      'clubs',
      'org_members',
      'organisations',
      'users',
    ]) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }
  }
}
