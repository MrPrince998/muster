import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Attendance numbers (README: "Analytics"), computed live from events and
 * registrations: a held event with two members and a guest (two of them
 * checked in), an upcoming event, a cancelled one and a draft.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let organiser: TestUser;
let ada: TestUser;
let bo: TestUser;
let cy: TestUser;
let clubId = '';
const ev = { held: '', upcoming: '', cancelled: '', draft: '' };
const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

beforeAll(async () => {
  t = await createTestApp();
  organiser = await t.user('Olive');
  [ada, bo, cy] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Stats ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  for (const u of [ada, bo, cy]) await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', u.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;

  const make = async (title: string, start: number, end: number, extra: object = {}) =>
    (
      await t
        .api()
        .post(`/clubs/${clubId}/events`)
        .set('Authorization', organiser.auth)
        .send({ title, startsAt: iso(start), endsAt: iso(end), publish: true, ...extra })
        .expect(201)
    ).body.id as string;
  // running now, so people can register and be scanned in; ended below
  ev.held = await make('Demo Night', -120, 60, { visibility: 'public', capacity: 10 });
  ev.upcoming = await make('Quiz Night', 2880, 3000);
  ev.cancelled = await make('Outdoor Race', 4320, 4400);
  ev.draft = await make('Secret Plans', 5000, 5100, { publish: false });

  const scan = (token: string) =>
    t.api().post(`/clubs/${clubId}/events/${ev.held}/check-in`).set('Authorization', organiser.auth).send({ token }).expect(200);
  for (const u of [ada, bo]) {
    await t.api().post(`/clubs/${clubId}/events/${ev.held}/my-registration`).set('Authorization', u.auth).expect(201);
  }
  const adaTicket = await t.api().get(`/clubs/${clubId}/events/${ev.held}/my-ticket`).set('Authorization', ada.auth).expect(200);
  await scan(adaTicket.body.token);

  // a guest, through the public page
  const guestEmail = `gwen-${t.suffix}@example.com`;
  await t.api().post(`/public/events/${ev.held}/places`).send({ name: 'Gwen', email: guestEmail }).expect(202);
  const link = t.mail.sent.filter((e) => e.to === guestEmail).at(-1)!.text.match(/confirm\?token=([\w.-]+)/)![1];
  const guest = await t.api().post(`/public/events/${ev.held}/places/confirm`).send({ token: link }).expect(200);
  await scan(guest.body.ticketToken);

  await t.api().post(`/clubs/${clubId}/events/${ev.upcoming}/my-registration`).set('Authorization', cy.auth).expect(201);
  await t.api().post(`/clubs/${clubId}/events/${ev.cancelled}/cancel`).set('Authorization', organiser.auth).send({}).expect(201);
  // the held event is over now
  await t
    .api()
    .patch(`/clubs/${clubId}/events/${ev.held}`)
    .set('Authorization', organiser.auth)
    .send({ startsAt: iso(-180), endsAt: iso(-30) })
    .expect(200);
});

afterAll(() => t.close());

describe('club attendance', () => {
  it('sums up the events held, ignoring upcoming, cancelled and draft ones', async () => {
    const res = await t.api().get(`/clubs/${clubId}/analytics`).set('Authorization', organiser.auth).expect(200);
    expect(res.body.summary).toEqual({
      eventsHeld: 1,
      upcomingEvents: 1,
      registered: 3,
      attended: 2,
      attendanceRate: 2 / 3,
      guests: 1,
    });
  });

  it('lists every event but drafts, latest first, with its own numbers', async () => {
    const { events } = (await t.api().get(`/clubs/${clubId}/analytics`).set('Authorization', organiser.auth).expect(200)).body;
    expect(events.map((e: { title: string }) => e.title)).toEqual(['Outdoor Race', 'Quiz Night', 'Demo Night']);
    expect(events[2]).toMatchObject({ registered: 3, attended: 2, guests: 1, ended: true, capacity: 10, status: 'published' });
    expect(events[0]).toMatchObject({ status: 'cancelled', ended: false });
  });

  it('gives the last 12 months, empty ones included, with the held event in its month', async () => {
    const { months } = (await t.api().get(`/clubs/${clubId}/analytics`).set('Authorization', organiser.auth).expect(200)).body;
    expect(months).toHaveLength(12);
    expect(months.map((m: { month: string }) => m.month)).toEqual([...months.map((m: { month: string }) => m.month)].sort());
    const totals = months.reduce(
      (sum: { events: number; registered: number; attended: number }, m: typeof sum) => ({
        events: sum.events + m.events,
        registered: sum.registered + m.registered,
        attended: sum.attended + m.attended,
      }),
      { events: 0, registered: 0, attended: 0 },
    );
    expect(totals).toEqual({ events: 1, registered: 3, attended: 2 });
  });

  it('is only for people who may see analytics', async () => {
    const res = await t.api().get(`/clubs/${clubId}/analytics`).set('Authorization', ada.auth).expect(403);
    expect(res.body.code).toBe('MISSING_PERMISSION');
  });
});
