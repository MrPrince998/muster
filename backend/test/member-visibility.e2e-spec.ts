import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Who a member can see by name. An open workspace lets anyone in, so a
 * plain member sees themselves, the staff, and people they share a club
 * with (General doesn't count: everyone's in it), on the Members page, in
 * search and in General's members alike. Staff see everyone.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let mod: TestUser;
let ada: TestUser;
let bo: TestUser;
let stranger: TestUser;
let orgId = '';
let generalId = '';

const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
  patch: (path: string, body: object) => t.api().patch(path).set('Authorization', u.auth).send(body),
});
const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
const membersPage = async (u: TestUser) => names((await as(u).get(`/orgs/${orgId}/members`).expect(200)).body);
const generalMembers = async (u: TestUser) => names((await as(u).get(`/clubs/${generalId}/members`).expect(200)).body);
const searchPeople = async (u: TestUser, q: string) =>
  names((await as(u).get(`/search?q=${encodeURIComponent(q)}`).expect(200)).body.people);

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  [mod, ada, bo, stranger] = [await t.user('Mo'), await t.user('Ada'), await t.user('Bo'), await t.user('Sid')];
  const org = await as(owner).post('/orgs', { name: `Visibility ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  orgId = org.body.id;
  for (const u of [mod, ada, bo, stranger]) await as(u).post(`/orgs/by-slug/${org.body.slug}/join`).expect(201);
  await as(owner).patch(`/orgs/${orgId}/members/${mod.id}`, { role: 'moderator' }).expect(204);
  generalId = (await as(owner).get(`/orgs/${orgId}/clubs`).expect(200)).body[0].id;
  // Ada and Bo share Chess; Sid is only in General
  const chess = (await as(owner).post(`/orgs/${orgId}/clubs`, { name: 'Chess' }).expect(201)).body.id;
  await as(owner).patch(`/clubs/${chess}/settings`, { joinPolicy: 'open' }).expect(200);
  for (const u of [ada, bo]) await as(u).post(`/orgs/${orgId}/club-directory/${chess}/join`).expect(200);
});
afterAll(() => t.close());

describe('who members can see', () => {
  it('shows a plain member themselves, the staff, and people in their clubs', async () => {
    const seen = [ada.name, bo.name, mod.name, owner.name].sort();
    expect(await membersPage(ada)).toEqual(seen);
    expect(await generalMembers(ada)).toEqual(seen);
  });

  it('shows someone only in General just themselves and the staff', async () => {
    const seen = [mod.name, owner.name, stranger.name].sort();
    expect(await membersPage(stranger)).toEqual(seen);
    expect(await generalMembers(stranger)).toEqual(seen);
    // search agrees: Ada is in the workspace, but not someone Sid can see
    expect(await searchPeople(stranger, ada.name)).toEqual([]);
    expect(await searchPeople(ada, bo.name)).toEqual([bo.name]);
  });

  it('shows staff everyone', async () => {
    const everyone = [ada.name, bo.name, mod.name, owner.name, stranger.name].sort();
    expect(await membersPage(mod)).toEqual(everyone);
    expect(await generalMembers(mod)).toEqual(everyone);
    expect(await searchPeople(mod, stranger.name)).toEqual([stranger.name]);
  });
});
