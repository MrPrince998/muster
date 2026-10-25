import { DataSource } from 'typeorm';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * A club's past events never stop growing, so they come a page at a time,
 * latest first, each event once.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let clubId = '';
let orgSlug = '';
// the table owner's connection: moving events into the past goes around the API (and RLS)
let db: DataSource;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  t = await createTestApp();
  db = await new DataSource({ type: 'postgres', url: process.env.MIGRATION_DATABASE_URL }).initialize();
  owner = await t.user('Olive');
  const org = await t.api().post('/orgs').set('Authorization', owner.auth).send({ name: `Past ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  orgSlug = org.body.slug;
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', owner.auth).expect(200)).body[0].id;
  // five that are over, one coming up
  for (const [i, days] of [-1, -2, -3, -4, -5, 3].entries()) {
    const event = await t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', owner.auth)
      .send({ title: `Night ${i + 1}`, startsAt: inDays(days + 10), endsAt: inDays(days + 10.1), publish: true })
      .expect(201);
    // moved into the past directly: the API won't create events that already happened
    await db.query(`UPDATE events SET starts_at = $2, ends_at = $3 WHERE id = $1`, [event.body.id, inDays(days), inDays(days + 0.1)]);
  }
});
afterAll(async () => {
  await db.destroy();
  await t.close();
});

describe('past events', () => {
  it('come a page at a time, latest first, each once, with the total', async () => {
    const seen: string[] = [];
    let before: string | null = null;
    let pages = 0;
    do {
      const path = `/clubs/${clubId}/events/past?limit=2${before ? `&before=${before}` : ''}`;
      const body: { events: { title: string }[]; next: string | null; total: number } = (
        await t.api().get(path).set('Authorization', owner.auth).expect(200)
      ).body;
      expect(body.total).toBe(5);
      seen.push(...body.events.map((e) => e.title));
      before = body.next;
      pages++;
    } while (before && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(['Night 1', 'Night 2', 'Night 3', 'Night 4', 'Night 5']);
  });

  it('refuses a cursor it did not make', async () => {
    const res = await t.api().get(`/clubs/${clubId}/events/past?before=nope`).set('Authorization', owner.auth).expect(400);
    expect(res.body.code).toBe('INVALID_CURSOR');
  });
});

describe("who's going", () => {
  // accounts take a moment each (scrypt): made before the test, not in it
  let people: TestUser[] = [];
  beforeAll(async () => {
    people = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  });

  it('comes a page at a time too, in the order they registered', async () => {
    const event = await t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', owner.auth)
      .send({ title: 'Big Night', startsAt: inDays(5), endsAt: inDays(5.1), publish: true })
      .expect(201);
    for (const person of people) {
      await t.api().post(`/orgs/by-slug/${orgSlug}/join`).set('Authorization', person.auth).expect(201);
      await t.api().post(`/clubs/${clubId}/events/${event.body.id}/my-registration`).set('Authorization', person.auth).expect(201);
    }
    const path = `/clubs/${clubId}/events/${event.body.id}/registrations`;
    const first = (await t.api().get(`${path}?limit=2`).set('Authorization', owner.auth).expect(200)).body;
    expect(first).toMatchObject({ total: 3, tallies: [] });
    expect(first.attendees.map((a: { name: string }) => a.name)).toEqual(['Ada', 'Bo']);
    const second = (await t.api().get(`${path}?limit=2&after=${first.next}`).set('Authorization', owner.auth).expect(200)).body;
    expect(second.attendees.map((a: { name: string }) => a.name)).toEqual(['Cy']);
    expect(second.next).toBeNull();
  });
});
