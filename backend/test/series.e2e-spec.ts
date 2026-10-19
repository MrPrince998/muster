import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Recurring events: one "repeats weekly, 4 times" makes four events, each at
 * the same local time in the workspace's zone (daylight saving or not), each
 * with its own places and tickets. "This and following" edits, cancels,
 * publishes or deletes the rest of the series at once.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let organiser: TestUser;
let ada: TestUser;
let clubId = '';

// Sydney leaves daylight saving on the first Sunday of April: UTC+11, then UTC+10
const year = new Date().getUTCFullYear() + 1;
const firstSunday = (() => {
  const d = new Date(Date.UTC(year, 3, 1));
  d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7));
  return d;
})();
// a Thursday 18:30-21:00 Sydney time (07:30 UTC on daylight time), a week and a half before the change
const start = new Date(firstSunday.getTime() - 10 * 86_400_000 + 7.5 * 3_600_000);
const end = new Date(start.getTime() + 2.5 * 3_600_000);

interface Event {
  id: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  series: { id: string; every: string; index: number; count: number } | null;
}

beforeAll(async () => {
  t = await createTestApp();
  organiser = await t.user('Olive');
  ada = await t.user('Ada');
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Series ${t.suffix}`, joinPolicy: 'open', timeZone: 'Australia/Sydney' })
    .expect(201);
  await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', ada.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;
});
afterAll(() => t.close());

const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
  patch: (path: string, body: object) => t.api().patch(path).set('Authorization', u.auth).send(body),
  delete: (path: string) => t.api().delete(path).set('Authorization', u.auth),
});

const series = async (title: string, scope: 'upcoming' | 'drafts' = 'upcoming'): Promise<Event[]> =>
  ((await as(organiser).get(`/clubs/${clubId}/events?scope=${scope}`).expect(200)).body as Event[]).filter(
    (e) => e.title.startsWith(title),
  );

// "18:30" on the clock in Sydney
const sydney = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );

describe('recurring events', () => {
  it('makes every occurrence at the same local time, through a daylight-saving change', async () => {
    const first = await as(organiser)
      .post(`/clubs/${clubId}/events`, {
        title: 'Build Night',
        location: 'Hall B',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        capacity: 20,
        publish: true,
        repeat: { every: 'week', count: 4 },
      })
      .expect(201);
    expect(first.body.series).toMatchObject({ every: 'week', index: 1, count: 4 });

    const events = await series('Build Night');
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.series!.index)).toEqual([1, 2, 3, 4]);
    expect(new Set(events.map((e) => e.series!.id)).size).toBe(1);
    // the clocks change between the 2nd and 3rd: the local time doesn't
    expect(events.map((e) => `${sydney(e.startsAt)}-${sydney(e.endsAt)}`)).toEqual(Array(4).fill('18:30-21:00'));
    expect(new Date(events[2].startsAt).getTime() - new Date(events[1].startsAt).getTime()).toBe(7 * 86_400_000 + 3_600_000);

    const oneOff = await as(organiser)
      .post(`/clubs/${clubId}/events`, { title: 'One-off', startsAt: start.toISOString(), endsAt: end.toISOString() })
      .expect(201);
    expect(oneOff.body.series).toBeNull();
  });

  it('refuses a series of one, or of more than a year of weeks', async () => {
    for (const repeat of [{ every: 'week', count: 1 }, { every: 'week', count: 53 }, { every: 'daily', count: 3 }]) {
      await as(organiser)
        .post(`/clubs/${clubId}/events`, { title: 'Nope', startsAt: start.toISOString(), endsAt: end.toISOString(), repeat })
        .expect(400);
    }
  });

  it('edits this and following: same fields, the time moved the same way on the clock', async () => {
    const [one, two, three] = await series('Build Night');
    for (const e of [two, three]) await as(ada).post(`/clubs/${clubId}/events/${e.id}/my-registration`).expect(201);

    // the 2nd moves to 19:00-21:30 and to Hall C, and so do the ones after it
    const moved = new Date(new Date(two.startsAt).getTime() + 30 * 60_000).toISOString();
    const movedEnd = new Date(new Date(two.endsAt).getTime() + 30 * 60_000).toISOString();
    await as(organiser)
      .patch(`/clubs/${clubId}/events/${two.id}?scope=following`, { location: 'Hall C', startsAt: moved, endsAt: movedEnd })
      .expect(200);

    const after = await series('Build Night');
    expect(after[0]).toMatchObject({ location: 'Hall B', startsAt: one.startsAt });
    expect(after.slice(1).map((e) => [e.location, sydney(e.startsAt), sydney(e.endsAt)])).toEqual(
      Array(3).fill(['Hall C', '19:00', '21:30']),
    );
    // each stays on its own date
    expect(after[2].startsAt.slice(0, 10)).toBe(three.startsAt.slice(0, 10));

    // Ada hears about both of hers
    await vi.waitFor(() =>
      expect(t.mail.sent.filter((e) => e.to === ada.email && e.subject === 'Changed: Build Night')).toHaveLength(2),
    );
  });

  it('edits only this one by default', async () => {
    const [one] = await series('Build Night');
    await as(organiser).patch(`/clubs/${clubId}/events/${one.id}`, { title: 'Build Night (kick-off)' }).expect(200);
    const titles = (await series('Build Night')).map((e) => e.title);
    expect(titles).toEqual(['Build Night (kick-off)', 'Build Night', 'Build Night', 'Build Night']);
  });

  it('cancels this and following, and leaves cancelled ones alone after', async () => {
    const [, two, three, four] = await series('Build Night');
    await as(organiser)
      .post(`/clubs/${clubId}/events/${three.id}/cancel?scope=following`, { reason: 'The hall is booked.' })
      .expect(201);
    const after = await series('Build Night');
    expect(after.map((e) => e.status)).toEqual(['published', 'published', 'cancelled', 'cancelled']);
    await vi.waitFor(() =>
      expect(t.mail.sent.some((e) => e.to === ada.email && e.subject === 'Cancelled: Build Night')).toBe(true),
    );

    // a later edit of the series skips the cancelled ones
    await as(organiser).patch(`/clubs/${clubId}/events/${two.id}?scope=following`, { title: 'Build Night Mk II' }).expect(200);
    const titles = Object.fromEntries((await series('Build Night')).map((e) => [e.id, e.title]));
    expect([titles[two.id], titles[three.id], titles[four.id]]).toEqual(['Build Night Mk II', 'Build Night', 'Build Night']);
  });

  it('publishes or deletes the rest of a draft series', async () => {
    await as(organiser)
      .post(`/clubs/${clubId}/events`, {
        title: 'Monthly Meetup',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        repeat: { every: 'month', count: 3 },
      })
      .expect(201);
    const [first, second] = await series('Monthly Meetup', 'drafts');
    await as(organiser).post(`/clubs/${clubId}/events/${second.id}/publish?scope=following`).expect(201);
    expect((await series('Monthly Meetup', 'drafts')).map((e) => e.id)).toEqual([first.id]);
    expect(await series('Monthly Meetup')).toHaveLength(2);

    await as(organiser).delete(`/clubs/${clubId}/events/${first.id}?scope=following`).expect(204);
    expect(await series('Monthly Meetup', 'drafts')).toHaveLength(0);
    // the published ones aren't drafts, so they stay
    expect(await series('Monthly Meetup')).toHaveLength(2);
  });

  it('only takes a known scope', async () => {
    const [one] = await series('Build Night');
    await as(organiser).patch(`/clubs/${clubId}/events/${one.id}?scope=everything`, { title: 'x' }).expect(400);
  });
});
