import { randomUUID } from 'node:crypto';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * The door with no signal: a scanner keeps the door's list, checks tickets
 * against it offline, and sends what it let in once it's back. The server
 * still decides: each goes through the same atomic check-in, at the time the
 * door saw it, and a ticket used first elsewhere is reported back.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let organiser: TestUser;
let ada: TestUser;
let bo: TestUser;
let cy: TestUser;
let clubId = '';
let eventId = '';
const registration: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  organiser = await t.user('Olive');
  [ada, bo, cy] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Door ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  for (const u of [ada, bo, cy]) await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', u.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  eventId = (
    await t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', organiser.auth)
      .send({ title: 'Night Market', startsAt: at(-60), endsAt: at(120), publish: true })
      .expect(201)
  ).body.id;
  for (const u of [ada, bo, cy]) {
    registration[u.name] = (
      await t.api().post(`/clubs/${clubId}/events/${eventId}/my-registration`).set('Authorization', u.auth).expect(201)
    ).body.id;
  }
  // Cy can't come after all
  await t.api().delete(`/clubs/${clubId}/events/${eventId}/my-registration`).set('Authorization', cy.auth).expect(204);
});
afterAll(() => t.close());

const roster = (u: TestUser) => t.api().get(`/clubs/${clubId}/events/${eventId}/check-in/roster`).set('Authorization', u.auth);
const sync = (u: TestUser, checkIns: object[]) =>
  t.api().post(`/clubs/${clubId}/events/${eventId}/check-in/sync`).set('Authorization', u.auth).send({ checkIns });

describe('offline check-in', () => {
  it("gives the door its list: every ticket, whose, and whether it's used or given back", async () => {
    const res = await roster(organiser).expect(200);
    expect(res.body.eventId).toBe(eventId);
    expect(res.body.tickets).toHaveLength(3);
    const cyTicket = res.body.tickets.find((x: { name: string }) => x.name === cy.name);
    expect(cyTicket).toMatchObject({ registrationId: registration[cy.name], userId: cy.id, cancelled: true, checkedInAt: null });
  });

  it('records what the door let in, at the time it did, and says what it could not', async () => {
    // Bo came in at another door, online, while this one had no signal
    await t
      .api()
      .post(`/clubs/${clubId}/events/${eventId}/check-in/manual`)
      .set('Authorization', organiser.auth)
      .send({ userId: bo.id })
      .expect(200);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const res = await sync(organiser, [
      { registrationId: registration[ada.name], at: tenMinutesAgo },
      { registrationId: registration[bo.name], at: tenMinutesAgo },
      { registrationId: registration[cy.name], at: tenMinutesAgo },
      { registrationId: randomUUID(), at: tenMinutesAgo },
    ]).expect(200);

    expect(res.body.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      'checked_in',
      'already_checked_in',
      'cancelled',
      'invalid',
    ]);
    expect(new Date(res.body.results[0].checkedInAt).toISOString()).toBe(tenMinutesAgo);
    expect(res.body.results[1]).toMatchObject({ attendeeName: bo.name, checkedInByName: organiser.name });
    expect(res.body).toMatchObject({ attendedCount: 2, registeredCount: 2 });

    // sending it again (a retry after a dropped answer) changes nothing
    const again = await sync(organiser, [{ registrationId: registration[ada.name], at: tenMinutesAgo }]).expect(200);
    expect(again.body.results[0].outcome).toBe('already_checked_in');
  });

  it("never records a check-in in the future, whatever the scanner's clock says", async () => {
    const event = await t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', organiser.auth)
      .send({ title: 'Clock Test', startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(), publish: true })
      .expect(201);
    const place = await t.api().post(`/clubs/${clubId}/events/${event.body.id}/my-registration`).set('Authorization', ada.auth).expect(201);
    const res = await t
      .api()
      .post(`/clubs/${clubId}/events/${event.body.id}/check-in/sync`)
      .set('Authorization', organiser.auth)
      .send({ checkIns: [{ registrationId: place.body.id, at: new Date(Date.now() + 86_400_000).toISOString() }] })
      .expect(200);
    expect(new Date(res.body.results[0].checkedInAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('is only for people who check people in, and takes a sensible batch', async () => {
    await roster(ada).expect(403);
    await sync(ada, [{ registrationId: registration[ada.name], at: new Date().toISOString() }]).expect(403);
    await sync(organiser, []).expect(400);
    await sync(organiser, [{ registrationId: 'nope', at: 'yesterday' }]).expect(400);
  });
});
