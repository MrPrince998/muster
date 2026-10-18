import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { TenantService } from '../src/database/tenant.service.js';
import { PermissionService } from '../src/modules/permission/permission.service.js';
import { Permission } from '../src/modules/permission/permissions.js';

/**
 * Proves tenant isolation is enforced by Postgres, not by application code
 * (README: "Testing → Tenant isolation"). Data is seeded as the schema owner;
 * every assertion runs as the limited app role the API uses.
 */

const TENANT_TABLES = [
  'organisations',
  'org_members',
  'clubs',
  'club_members',
  'roles',
  'member_roles',
  'invites',
  'join_requests',
  'org_join_requests',
  'events',
  'registrations',
];

const id = () => randomUUID();
const suffix = randomUUID().slice(0, 8);

const A = { org: id(), user: id(), club: id(), role: id(), event: id(), invite: id(), slug: `a-${suffix}` };
const B = { org: id(), user: id(), club: id(), role: id(), event: id(), invite: id(), slug: `b-${suffix}` };

let owner: DataSource;
let app: DataSource;
let tenant: TenantService;

async function seed(t: typeof A, name: string) {
  await owner.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [
    t.user,
    `${name}-${suffix}@example.com`,
    name,
  ]);
  await owner.query(`INSERT INTO organisations (id, name, slug) VALUES ($1, $2, $3)`, [t.org, name, t.slug]);
  await owner.query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [t.org, t.user]);
  await owner.query(`INSERT INTO clubs (id, org_id, name, slug, is_default) VALUES ($1, $2, 'General', 'general', true)`, [
    t.club,
    t.org,
  ]);
  await owner.query(`INSERT INTO club_members (club_id, user_id, org_id) VALUES ($1, $2, $3)`, [t.club, t.user, t.org]);
  await owner.query(
    `INSERT INTO roles (id, org_id, club_id, name, position, permissions) VALUES ($1, $2, $3, 'Organizer', 30, $4)`,
    [t.role, t.org, t.club, [Permission.EventCreate, Permission.CheckinScan]],
  );
  await owner.query(`INSERT INTO member_roles (club_id, user_id, role_id, org_id) VALUES ($1, $2, $3, $4)`, [
    t.club,
    t.user,
    t.role,
    t.org,
  ]);
  await owner.query(`INSERT INTO invites (id, org_id, club_id, code) VALUES ($1, $2, $3, $4)`, [
    t.invite,
    t.org,
    t.club,
    `code-${t.invite}`,
  ]);
  await owner.query(`INSERT INTO join_requests (org_id, club_id, invite_id, user_id) VALUES ($1, $2, $3, $4)`, [
    t.org,
    t.club,
    t.invite,
    t.user,
  ]);
  await owner.query(`INSERT INTO org_join_requests (org_id, user_id) VALUES ($1, $2)`, [t.org, t.user]);
  await owner.query(
    `INSERT INTO events (id, org_id, club_id, title, starts_at, ends_at)
     VALUES ($1, $2, $3, 'Meetup', now(), now() + interval '2 hours')`,
    [t.event, t.org, t.club],
  );
  await owner.query(`INSERT INTO registrations (org_id, event_id, user_id) VALUES ($1, $2, $3)`, [
    t.org,
    t.event,
    t.user,
  ]);
}

async function pgError(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  const error = await promise.then(
    () => {
      throw new Error('expected the query to fail');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(QueryFailedError);
  const { driverError } = error as QueryFailedError & { driverError: { code?: string; message: string } };
  return driverError;
}

beforeAll(async () => {
  owner = await new DataSource({ type: 'postgres', url: process.env.MIGRATION_DATABASE_URL }).initialize();
  // a single pooled connection, so the leak test reuses the same session
  app = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL, extra: { max: 1 } }).initialize();
  tenant = new TenantService(app);

  await seed(A, 'Alpha');
  await seed(B, 'Bravo');
});

afterAll(async () => {
  // deleting the orgs cascades to everything tenant-scoped
  await owner?.query(`DELETE FROM organisations WHERE id = ANY($1)`, [[A.org, B.org]]);
  await owner?.query(`DELETE FROM users WHERE id = ANY($1)`, [[A.user, B.user]]);
  await owner?.destroy();
  await app?.destroy();
});

describe('tenant isolation (RLS)', () => {
  it('connects as a role that cannot bypass RLS', async () => {
    const [r] = await app.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it.each(TENANT_TABLES)('returns no rows from %s when no tenant is set', async (table) => {
    const rows = await app.query(`SELECT * FROM ${table}`);
    expect(rows).toHaveLength(0);
  });

  it.each(TENANT_TABLES)('returns only the current tenant from %s, even unfiltered', async (table) => {
    const column = table === 'organisations' ? 'id' : 'org_id';
    const orgIds: { org: string }[] = await tenant.withTenant(A.org, (m) =>
      m.query(`SELECT DISTINCT ${column} AS org FROM ${table}`),
    );
    expect(orgIds).toEqual([{ org: A.org }]);
  });

  it('rejects inserting a row into another tenant', async () => {
    const error = await pgError(
      tenant.withTenant(A.org, (m) =>
        m.query(`INSERT INTO clubs (org_id, name, slug) VALUES ($1, 'Sneaky', 'sneaky')`, [B.org]),
      ),
    );
    expect(error.code).toBe('42501');
    expect(error.message).toMatch(/row-level security/);
  });

  it('rejects moving a row into another tenant', async () => {
    const error = await pgError(
      tenant.withTenant(A.org, (m) => m.query(`UPDATE events SET org_id = $1 WHERE id = $2`, [B.org, A.event])),
    );
    expect(error.message).toMatch(/row-level security/);
  });

  it("cannot update or delete another tenant's rows (they are invisible)", async () => {
    const [updated, deleted] = await tenant.withTenant(A.org, async (m) => [
      await m.query(`UPDATE events SET title = 'hacked' WHERE id = $1`, [B.event]),
      await m.query(`DELETE FROM registrations WHERE org_id = $1`, [B.org]),
    ]);
    // node-postgres via TypeORM returns [rows, affectedCount] for UPDATE/DELETE
    expect(updated[1]).toBe(0);
    expect(deleted[1]).toBe(0);
    const [{ title }] = await owner.query(`SELECT title FROM events WHERE id = $1`, [B.event]);
    expect(title).toBe('Meetup');
  });

  it('does not leak the tenant to the next use of the pooled connection', async () => {
    await tenant.withTenant(A.org, (m) => m.query(`SELECT 1`));
    // same single connection, outside the transaction
    expect(await app.query(`SELECT current_org_id() AS org`)).toEqual([{ org: null }]);
    expect(await app.query(`SELECT * FROM clubs`)).toHaveLength(0);
  });

  it('clears the tenant when the transaction fails', async () => {
    await expect(
      tenant.withTenant(A.org, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await app.query(`SELECT current_org_id() AS org`)).toEqual([{ org: null }]);
  });

  it('refuses a tenant id that is not a uuid', async () => {
    await expect(tenant.withTenant("' OR 1=1 --", async () => undefined)).rejects.toThrow(/uuid/);
  });

  describe('the app role cannot switch RLS off', () => {
    it('cannot turn row security off for its session', async () => {
      // for a role subject to RLS, row_security = off makes the query fail
      // instead of silently returning everything
      const error = await pgError(
        app.transaction(async (m) => {
          await m.query(`SET LOCAL row_security = off`);
          return m.query(`SELECT * FROM clubs`);
        }),
      );
      expect(error.message).toMatch(/row-level security/);
    });

    it('cannot disable or alter policies', async () => {
      const error = await pgError(app.query(`ALTER TABLE clubs DISABLE ROW LEVEL SECURITY`));
      expect(error.message).toMatch(/must be owner/);
    });

    it('cannot create its own tables', async () => {
      const error = await pgError(app.query(`CREATE TABLE escape_hatch (id int)`));
      expect(error.code).toBe('42501');
    });

    it('cannot read the migrations ledger', async () => {
      const error = await pgError(app.query(`SELECT * FROM migrations`));
      expect(error.code).toBe('42501');
    });
  });

  describe('tenant resolution', () => {
    it('resolves an org from public identifiers without a tenant set', async () => {
      expect(await tenant.orgIdForSlug(A.slug.toUpperCase())).toBe(A.org);
      expect(await tenant.orgIdForClub(B.club)).toBe(B.org);
      expect(await tenant.orgIdForEvent(A.event)).toBe(A.org);
      expect(await tenant.orgIdForInviteCode(`code-${B.invite}`)).toBe(B.org);
    });

    it('returns null for unknown or malformed identifiers', async () => {
      expect(await tenant.orgIdForSlug('does-not-exist')).toBeNull();
      expect(await tenant.orgIdForClub(randomUUID())).toBeNull();
      expect(await tenant.orgIdForClub('not-a-uuid')).toBeNull();
    });

    it("lists only the user's own workspaces", async () => {
      const orgs = await tenant.userOrganisations(A.user);
      expect(orgs).toEqual([expect.objectContaining({ orgId: A.org, slug: A.slug, role: 'owner' })]);
    });
  });

  describe('permission lookup under RLS', () => {
    const permissions = () => new PermissionService(tenant);

    it("resolves a member's access in their own club", async () => {
      const access = await permissions().getClubAccess(A.club, A.user);
      expect(access?.highestPosition).toBe(30);
      expect(access?.has(Permission.EventCreate)).toBe(true);
      expect(access?.has(Permission.RoleManage)).toBe(false);
    });

    it("finds no access in another tenant's club", async () => {
      expect(await permissions().getClubAccess(B.club, A.user)).toBeNull();
    });
  });
});
