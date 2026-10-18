import type { MigrationInterface, QueryRunner } from 'typeorm';

// the parts of node-postgres' client used here (pg ships no types)
interface PgClient {
  query(sql: string): Promise<unknown>;
  escapeIdentifier(value: string): string;
  escapeLiteral(value: string): string;
}

// every table that carries org_id; each gets the same policy
const TENANT_TABLES = [
  'org_members',
  'clubs',
  'club_members',
  'roles',
  'member_roles',
  'invites',
  'join_requests',
  'events',
  'registrations',
] as const;

/**
 * The app's database role is taken from DATABASE_URL, so the credentials the
 * app connects with are the ones created here. Migrations themselves run as
 * the owner (MIGRATION_DATABASE_URL).
 */
function appRoleFromEnv(): { role: string; password: string } {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required to create the app database role');
  const url = new URL(raw);
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!role || !password) throw new Error('DATABASE_URL must include a username and password');
  // the role name is interpolated into GRANT statements below
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`App role "${role}" must be lowercase letters, digits and underscores`);
  }
  return { role, password };
}

/**
 * Multi-tenant isolation enforced by Postgres (README: "Multi-tenancy").
 *
 * 1. A limited login role for the app: not superuser, no BYPASSRLS, not the
 *    table owner. Superusers and BYPASSRLS roles skip RLS entirely, so the app
 *    must never connect as the owner.
 * 2. RLS enabled and FORCED on every tenant table, with one policy: a row is
 *    visible and writable only if its org_id is the current org.
 * 3. The current org comes from the transaction-local setting
 *    app.current_org_id, set by withTenant(). Unset means NULL, which matches
 *    nothing: forgetting withTenant() returns no rows instead of every row.
 * 4. A few SECURITY DEFINER lookups answer "which org is this?" before a
 *    tenant is known (/o/:slug, /join/:code, a ticket's event). They only
 *    return ids, never tenant data.
 *
 * Requires the migration role to be a superuser or have BYPASSRLS, so the
 * lookup functions (which run as their owner) can see through RLS.
 */
export class TenantIsolation1760000000001 implements MigrationInterface {
  name = 'TenantIsolation1760000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    const { role, password } = appRoleFromEnv();

    const [{ current_user: owner }] = (await queryRunner.query(`SELECT current_user`)) as {
      current_user: string;
    }[];
    if (role === owner) {
      throw new Error(
        `DATABASE_URL uses "${role}", the migration owner. The app must connect as a separate limited role.`,
      );
    }

    // Postgres 13 lets every role create objects in the public schema; the app
    // role must not be able to create its own (RLS-free) tables
    await queryRunner.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);

    // --- app role --------------------------------------------------------
    const [{ exists }] = (await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
      [role],
    )) as { exists: boolean }[];
    // CREATE ROLE takes no bind parameters, so the password has to be inlined.
    // It goes through the raw pg client (same connection and transaction)
    // because TypeORM's logger would print the statement, password included.
    const client = (await queryRunner.connect()) as PgClient;
    await client.query(
      `${exists ? 'ALTER' : 'CREATE'} ROLE ${client.escapeIdentifier(role)} ` +
        `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT ` +
        `PASSWORD ${client.escapeLiteral(password)}`,
    );

    const [{ grants }] = (await queryRunner.query(
      `SELECT format(
         'GRANT CONNECT ON DATABASE %I TO %I; GRANT USAGE ON SCHEMA public TO %I',
         current_database(), $1::text, $1::text
       ) AS grants`,
      [role],
    )) as { grants: string }[];
    await queryRunner.query(grants);

    // data access only: no DDL, no TRUNCATE, no ownership
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    );
    // tables created by later migrations get the same grants automatically
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
    );
    // the migrations ledger is the owner's business
    await queryRunner.query(`REVOKE ALL ON TABLE migrations FROM "${role}"`);

    // --- current tenant ----------------------------------------------------
    await queryRunner.query(`
      CREATE FUNCTION current_org_id() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid $$
    `);

    // --- policies ------------------------------------------------------------
    // USING filters what can be read, updated and deleted; WITH CHECK rejects
    // inserts and updates that would put a row into another org
    for (const table of TENANT_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      // FORCE: applies to the table owner too, not only other roles
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON ${table}
          USING (org_id = current_org_id())
          WITH CHECK (org_id = current_org_id())
      `);
    }

    // the tenant table itself: you only see the org you are in
    await queryRunner.query(`ALTER TABLE organisations ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE organisations FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON organisations
        USING (id = current_org_id())
        WITH CHECK (id = current_org_id())
    `);

    // users is global (one person, many workspaces): no RLS

    // --- tenant resolution ---------------------------------------------------
    // SECURITY DEFINER runs as the owner, so these see through RLS. Each one
    // takes a public identifier and returns only an org id. search_path is
    // pinned so a caller cannot shadow the tables with their own objects.
    const resolvers: [signature: string, body: string][] = [
      // /o/:slug
      ['org_id_for_slug(p_slug text)', `SELECT id FROM organisations WHERE slug = lower(p_slug)`],
      // /clubs/:clubId/... and the permission guard
      ['org_id_for_club(p_club_id uuid)', `SELECT org_id FROM clubs WHERE id = p_club_id`],
      // ticket check-in: the token carries the event id
      ['org_id_for_event(p_event_id uuid)', `SELECT org_id FROM events WHERE id = p_event_id`],
      // /join/:code
      ['org_id_for_invite_code(p_code text)', `SELECT org_id FROM invites WHERE code = p_code`],
    ];
    for (const [signature, body] of resolvers) {
      await queryRunner.query(`
        CREATE FUNCTION ${signature} RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, public
        AS $$ ${body} $$
      `);
    }

    // "my workspaces": the one query that is cross-tenant by nature. Scoped to
    // a single user; the caller must pass the authenticated user's id.
    await queryRunner.query(`
      CREATE FUNCTION user_organisations(p_user_id uuid)
      RETURNS TABLE (org_id uuid, name varchar, slug varchar, role varchar, joined_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT o.id, o.name, o.slug, m.role, m.joined_at
        FROM org_members m
        JOIN organisations o ON o.id = m.org_id
        WHERE m.user_id = p_user_id
        ORDER BY o.name
      $$
    `);

    // functions are executable by PUBLIC by default; limit them to the app
    for (const fn of [
      'org_id_for_slug(text)',
      'org_id_for_club(uuid)',
      'org_id_for_event(uuid)',
      'org_id_for_invite_code(text)',
      'user_organisations(uuid)',
    ]) {
      await queryRunner.query(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`);
      await queryRunner.query(`GRANT EXECUTE ON FUNCTION ${fn} TO "${role}"`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const { role } = appRoleFromEnv();

    for (const fn of [
      'user_organisations(uuid)',
      'org_id_for_invite_code(text)',
      'org_id_for_event(uuid)',
      'org_id_for_club(uuid)',
      'org_id_for_slug(text)',
    ]) {
      await queryRunner.query(`DROP FUNCTION ${fn}`);
    }

    for (const table of ['organisations', ...TENANT_TABLES]) {
      await queryRunner.query(`DROP POLICY tenant_isolation ON ${table}`);
      await queryRunner.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }

    await queryRunner.query(`DROP FUNCTION current_org_id()`);

    // revokes every grant and default privilege, then removes the role
    await queryRunner.query(`DROP OWNED BY "${role}"`);
    await queryRunner.query(`DROP ROLE "${role}"`);

    await queryRunner.query(`GRANT CREATE ON SCHEMA public TO PUBLIC`);
  }
}
