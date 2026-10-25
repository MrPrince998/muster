import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Each club decides who can join it: anyone in the workspace (from the club
 * directory), by asking (its approvers decide, in its own settings), or only
 * with an invite link, as every club was before.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;
let bo: TestUser;
let cy: TestUser;
let orgId = '';
let generalId = '';
let chessId = '';

const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) =>
    t.api().post(path).set('Authorization', u.auth).send(body),
  patch: (path: string, body: object) =>
    t.api().patch(path).set('Authorization', u.auth).send(body),
  delete: (path: string) => t.api().delete(path).set('Authorization', u.auth),
});
const directory = async (u: TestUser) =>
  (await as(u).get(`/orgs/${orgId}/club-directory`).expect(200)).body as {
    id: string;
    name: string;
    joinPolicy: string;
    isMember: boolean;
    requested: boolean;
  }[];
const setPolicy = (joinPolicy: string) =>
  as(owner).patch(`/clubs/${chessId}/settings`, { joinPolicy }).expect(200);

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  [ada, bo, cy] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  const org = await as(owner)
    .post('/orgs', { name: `Clubs ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  orgId = org.body.id;
  for (const u of [ada, bo, cy])
    await as(u).post(`/orgs/by-slug/${org.body.slug}/join`).expect(201);
  generalId = (await as(owner).get(`/orgs/${orgId}/clubs`).expect(200)).body[0]
    .id;
  chessId = (
    await as(owner)
      .post(`/orgs/${orgId}/clubs`, { name: 'Chess Club' })
      .expect(201)
  ).body.id;
});
afterAll(() => t.close());

describe('club join settings', () => {
  it('starts invite-only, as clubs always were: not in the directory, no way in without a link', async () => {
    const settings = await as(owner)
      .get(`/clubs/${chessId}/settings`)
      .expect(200);
    expect(settings.body).toMatchObject({
      name: 'Chess Club',
      joinPolicy: 'invite',
      isDefault: false,
    });
    expect((await directory(ada)).map((c) => c.name)).toEqual([]);
    expect(
      (
        await as(ada)
          .post(`/orgs/${orgId}/club-directory/${chessId}/join`)
          .expect(403)
      ).body.code,
    ).toBe('CLUB_INVITE_ONLY');
    // the owner sees their own club there
    expect((await directory(owner)).map((c) => [c.name, c.isMember])).toEqual([
      ['Chess Club', true],
    ]);
  });

  it('lets anyone in the workspace straight in when open', async () => {
    await setPolicy('open');
    expect((await directory(ada))[0]).toMatchObject({
      name: 'Chess Club',
      joinPolicy: 'open',
      isMember: false,
    });
    expect(
      (
        await as(ada)
          .post(`/orgs/${orgId}/club-directory/${chessId}/join`)
          .expect(200)
      ).body,
    ).toEqual({ status: 'joined' });
    expect(
      (await as(ada).get(`/orgs/${orgId}/clubs`).expect(200)).body.map(
        (c: { name: string }) => c.name,
      ),
    ).toContain('Chess Club');
    expect(
      (
        await as(ada)
          .post(`/orgs/${orgId}/club-directory/${chessId}/join`)
          .expect(409)
      ).body.code,
    ).toBe('ALREADY_IN_CLUB');
  });

  it('takes a request, once, for the club to decide in its own settings', async () => {
    await setPolicy('request');
    expect(
      (
        await as(bo)
          .post(`/orgs/${orgId}/club-directory/${chessId}/join`, {
            message: 'I play at the library',
          })
          .expect(200)
      ).body,
    ).toEqual({
      status: 'requested',
    });
    await as(bo)
      .post(`/orgs/${orgId}/club-directory/${chessId}/join`, {
        message: 'Still keen',
      })
      .expect(200);
    expect((await directory(bo))[0]).toMatchObject({
      isMember: false,
      requested: true,
    });

    const pending = (
      await as(owner).get(`/clubs/${chessId}/join-requests`).expect(200)
    ).body;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      name: bo.name,
      message: 'Still keen',
      viaLink: false,
      roleName: null,
    });
    // the club's own count
    expect(
      (await as(owner).get(`/orgs/${orgId}/clubs`).expect(200)).body.find(
        (c: { id: string }) => c.id === chessId,
      ).pendingJoinRequests,
    ).toBe(1);

    await as(owner)
      .post(`/clubs/${chessId}/join-requests/${pending[0].id}/approve`)
      .expect(204);
    expect((await directory(bo))[0]).toMatchObject({
      isMember: true,
      requested: false,
    });
  });

  it('lets someone take a request back', async () => {
    await as(cy)
      .post(`/orgs/${orgId}/club-directory/${chessId}/join`)
      .expect(200);
    await as(cy)
      .delete(`/orgs/${orgId}/club-directory/${chessId}/join-request`)
      .expect(204);
    await as(cy)
      .delete(`/orgs/${orgId}/club-directory/${chessId}/join-request`)
      .expect(404);
    expect(
      (await as(owner).get(`/clubs/${chessId}/join-requests`).expect(200)).body,
    ).toHaveLength(0);
  });

  it("is the club's owner's (or role managers') to change, and records who did", async () => {
    expect(
      (
        await as(ada)
          .patch(`/clubs/${chessId}/settings`, { joinPolicy: 'open' })
          .expect(403)
      ).body.code,
    ).toBe('MISSING_PERMISSION');
    const renamed = await as(owner)
      .patch(`/clubs/${chessId}/settings`, {
        name: 'Chess & Go',
        description: 'Tuesdays.',
      })
      .expect(200);
    expect(renamed.body).toMatchObject({
      name: 'Chess & Go',
      description: 'Tuesdays.',
      joinPolicy: 'request',
    });
    const log = (
      await as(owner).get(`/orgs/${orgId}/audit?clubId=${chessId}`).expect(200)
    ).body.entries.map((e: { summary: string }) => e.summary);
    expect(log).toEqual(
      expect.arrayContaining([
        "changed Chess & Go's name and description",
        "changed Chess & Go's join setting (by asking)",
        "changed Chess & Go's join setting (anyone in the workspace)",
      ]),
    );
  });

  it('leaves who joins the default club to the workspace', async () => {
    expect(
      (
        await as(owner)
          .patch(`/clubs/${generalId}/settings`, { joinPolicy: 'request' })
          .expect(409)
      ).body.code,
    ).toBe('DEFAULT_CLUB');
    await as(owner)
      .patch(`/clubs/${generalId}/settings`, { description: 'Everyone.' })
      .expect(200);
    await as(ada)
      .post(`/orgs/${orgId}/club-directory/${generalId}/join`)
      .expect(409);
  });
});
