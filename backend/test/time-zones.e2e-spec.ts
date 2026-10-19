import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Each workspace keeps its own time zone, and every time it sends or shows
 * is in it: an event at 18:30 in Tokyo is 18:30 in the email, whoever reads
 * it and wherever the server runs.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  ada = await t.user('Ada');
});
afterAll(() => t.close());

const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
  patch: (path: string, body: object) => t.api().patch(path).set('Authorization', u.auth).send(body),
});
// 09:30 UTC on a fixed day next year: 18:30 in Tokyo (UTC+9, no daylight saving)
const nextYear = new Date().getUTCFullYear() + 1;
const startsAt = `${nextYear}-03-12T09:30:00.000Z`;
const endsAt = `${nextYear}-03-12T12:00:00.000Z`;

describe('workspace time zones', () => {
  it('refuses a zone that does not exist', async () => {
    const res = await as(owner).post('/orgs', { name: `Nowhere ${t.suffix}`, timeZone: 'Mars/Olympus_Mons' }).expect(400);
    expect(JSON.stringify(res.body.details)).toContain('timeZone must be a time zone');
  });

  it('writes every time in the workspace zone, and follows a change of zone', async () => {
    const org = await as(owner)
      .post('/orgs', { name: `Tokyo ${t.suffix}`, timeZone: 'Asia/Tokyo', joinPolicy: 'open' })
      .expect(201);
    expect(org.body.timeZone).toBe('Asia/Tokyo');
    const mine = await as(owner).get('/orgs').expect(200);
    expect(mine.body.find((o: { orgId: string }) => o.orgId === org.body.id).timeZone).toBe('Asia/Tokyo');

    await as(ada).post(`/orgs/by-slug/${org.body.slug}/join`).expect(201);
    const clubId = (await as(owner).get(`/orgs/${org.body.id}/clubs`).expect(200)).body[0].id;
    const event = await as(owner)
      .post(`/clubs/${clubId}/events`, { title: 'Ramen Night', startsAt, endsAt, publish: true, visibility: 'public' })
      .expect(201);

    // the ticket email, and the ticket itself, in Tokyo time
    await as(ada).post(`/clubs/${clubId}/events/${event.body.id}/my-registration`).expect(201);
    await vi.waitFor(() => expect(t.mail.sent.some((e) => e.to === ada.email && e.subject === 'Your ticket: Ramen Night')).toBe(true));
    const ticketEmail = t.mail.sent.find((e) => e.to === ada.email && e.subject === 'Your ticket: Ramen Night')!;
    expect(ticketEmail.text).toMatch(/When: \w+, 12 March \d{4}, 18:30 to 21:00 \(GMT\+9\)/);
    const tickets = await as(ada).get('/me/tickets').expect(200);
    expect(tickets.body.find((x: { eventId: string }) => x.eventId === event.body.id).timeZone).toBe('Asia/Tokyo');

    // the public page says which zone its times are in
    expect((await t.api().get(`/public/events/${event.body.id}`).expect(200)).body.timeZone).toBe('Asia/Tokyo');

    // the club moves to Auckland: the next email is in Auckland time
    const moved = await as(owner).patch(`/orgs/${org.body.id}`, { timeZone: 'Pacific/Auckland' }).expect(200);
    expect(moved.body.timeZone).toBe('Pacific/Auckland');
    await as(owner).patch(`/clubs/${clubId}/events/${event.body.id}`, { location: 'Ponsonby Hall' }).expect(200);
    await vi.waitFor(() => expect(t.mail.sent.some((e) => e.to === ada.email && e.subject === 'Changed: Ramen Night')).toBe(true));
    const changed = t.mail.sent.find((e) => e.to === ada.email && e.subject === 'Changed: Ramen Night')!;
    // 09:30 UTC in March is 22:30 in Auckland (UTC+13, daylight saving)
    expect(changed.text).toMatch(/When: \w+, 12 March \d{4}, 22:30 to \w+, 13 March \d{4}, 01:00 \(GMT\+13\)/);
  });

  it('only admins and the owner may change it, and only to a real zone', async () => {
    const org = await as(owner).post('/orgs', { name: `Zones ${t.suffix}`, joinPolicy: 'open' }).expect(201);
    await as(ada).post(`/orgs/by-slug/${org.body.slug}/join`).expect(201);
    await as(ada).patch(`/orgs/${org.body.id}`, { timeZone: 'Europe/London' }).expect(403);
    await as(owner).patch(`/orgs/${org.body.id}`, { timeZone: 'Not/AZone' }).expect(400);
    expect((await as(owner).patch(`/orgs/${org.body.id}`, { timeZone: 'Europe/London' }).expect(200)).body.timeZone).toBe(
      'Europe/London',
    );
  });
});
