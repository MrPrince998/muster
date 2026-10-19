import { DataSource } from 'typeorm';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * The audit log: who changed what in a workspace, written with the change
 * itself, read by the workspace's admins as sentences, and append-only: the
 * app's own database role can't rewrite or remove a line.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;
let bo: TestUser;
let orgId = '';
let clubId = '';

interface Entry {
  actorName: string;
  summary: string;
  action: string;
  clubName: string | null;
}

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  ada = await t.user('Ada');
  bo = await t.user('Bo');
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', owner.auth)
    .send({ name: `Audit ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  orgId = org.body.id;
  for (const u of [ada, bo]) await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', u.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${orgId}/clubs`).set('Authorization', owner.auth).expect(200)).body[0].id;

  const as = (u: TestUser) => ({
    post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
    patch: (path: string, body: object) => t.api().patch(path).set('Authorization', u.auth).send(body),
    get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  });
  // a few things worth knowing about, in order
  await as(owner).patch(`/orgs/${orgId}/members/${ada.id}`, { role: 'admin' }).expect(204);
  await as(owner).patch(`/orgs/${orgId}`, { timeZone: 'Asia/Tokyo' }).expect(200);
  const roles = await as(owner).post(`/clubs/${clubId}/roles`, { name: 'Door crew', permissions: ['checkin.scan'] }).expect(201);
  const doorCrew = roles.body.find((role: { name: string }) => role.name === 'Door crew').id;
  await t.api().put(`/clubs/${clubId}/members/${ada.id}/roles`).set('Authorization', owner.auth).send({ roleIds: [doorCrew] }).expect(200);
  const startsAt = new Date(Date.now() - 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + 3_600_000).toISOString();
  const event = await as(owner).post(`/clubs/${clubId}/events`, { title: 'Quiz Night', startsAt, endsAt, publish: true }).expect(201);
  await as(bo).post(`/clubs/${clubId}/events/${event.body.id}/my-registration`).expect(201);
  await as(ada).post(`/clubs/${clubId}/events/${event.body.id}/check-in/manual`, { userId: bo.id }).expect(200);
  await as(owner).patch(`/clubs/${clubId}/events/${event.body.id}`, { registrationOpen: false }).expect(200);
  await as(owner).get(`/clubs/${clubId}/events/${event.body.id}/registrations/export`).expect(200);
  await as(owner).post(`/clubs/${clubId}/events/${event.body.id}/cancel`, { reason: 'Quizmaster is ill' }).expect(201);
});
afterAll(() => t.close());

const page = (u: TestUser, query = '') => t.api().get(`/orgs/${orgId}/audit${query}`).set('Authorization', u.auth);

describe('audit log', () => {
  it('reads as who did what, newest first', async () => {
    const res = await page(owner).expect(200);
    const lines = (res.body.entries as Entry[]).map((e) => `${e.actorName} ${e.summary}`);
    expect(lines).toEqual([
      `${owner.name} cancelled “Quiz Night”, telling 1 person`,
      `${owner.name} downloaded the attendee list for “Quiz Night” (1 person)`,
      `${owner.name} closed registration for “Quiz Night”`,
      `${ada.name} checked ${bo.name} in by name, without a ticket`,
      `${owner.name} published “Quiz Night” in General`,
      `${owner.name} gave ${ada.name} Door crew in General`,
      `${owner.name} created the role Door crew in General`,
      `${owner.name} changed the workspace’s time zone (time zone now Asia/Tokyo)`,
      `${owner.name} made ${ada.name} an admin (was member)`,
    ]);
    expect(res.body.next).toBeNull();
  });

  it('is for admins and the owner only', async () => {
    await page(ada).expect(200);
    const res = await page(bo).expect(403);
    expect(res.body.code).toBe('INSUFFICIENT_ORG_ROLE');
  });

  it('pages without repeating or skipping a line, and filters by club', async () => {
    const first = await page(owner, '?limit=3').expect(200);
    expect(first.body.entries).toHaveLength(3);
    const second = await page(owner, `?limit=10&before=${first.body.next}`).expect(200);
    expect(second.body.entries).toHaveLength(6);
    expect(second.body.next).toBeNull();
    const all = [...first.body.entries, ...second.body.entries].map((e: { id: string }) => e.id);
    expect(new Set(all).size).toBe(9);

    const club = await page(owner, `?clubId=${clubId}`).expect(200);
    // the workspace-wide lines (roles, settings) aren't any club's
    expect(club.body.entries).toHaveLength(7);
    await page(owner, '?before=garbage').expect(400);
  });

  it("can't be rewritten or erased by the app", async () => {
    const app = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL }).initialize();
    try {
      await app.transaction(async (m) => {
        await m.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
        await expect(m.query(`UPDATE audit_log SET action = 'nothing'`)).rejects.toThrow(/permission denied/);
      });
      await app.transaction(async (m) => {
        await m.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
        await expect(m.query(`DELETE FROM audit_log`)).rejects.toThrow(/permission denied/);
      });
    } finally {
      await app.destroy();
    }
  });
});
