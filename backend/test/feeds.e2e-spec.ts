import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Calendar feeds: a member subscribes to their club once, and their calendar
 * app keeps up with every new, moved or cancelled event. The link is the
 * proof (calendar apps can't sign in), so it only works for members, and
 * resetting it turns the old one off.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let organiser: TestUser;
let ada: TestUser;
let outsider: TestUser;
let clubId = '';

const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  t = await createTestApp();
  organiser = await t.user('Olive');
  ada = await t.user('Ada');
  outsider = await t.user('Otto');
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Feeds ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', ada.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;
  const event = (title: string, publish: boolean, days: number) =>
    t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', organiser.auth)
      .send({ title, startsAt: at(days), endsAt: at(days + 0.1), publish })
      .expect(201);
  await event('Open Night', true, 3);
  await event('Secret Plans', false, 4);
  const called = await event('Rained Off', true, 5);
  await t.api().post(`/clubs/${clubId}/events/${called.body.id}/cancel`).set('Authorization', organiser.auth).send({}).expect(201);
});
afterAll(() => t.close());

const token = async (u: TestUser) => (await t.api().get('/me/calendar-feed').set('Authorization', u.auth).expect(200)).body.token as string;
const feed = (tok: string, club = clubId) => t.api().get(`/feeds/${tok}/clubs/${club}.ics`).buffer(true);

describe('calendar feeds', () => {
  it("gives a member their club's events, cancelled ones struck out, drafts left out", async () => {
    const res = await feed(await token(ada)).expect(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.text).toContain('X-WR-CALNAME:General\\, Feeds');
    expect(res.text).toContain('SUMMARY:Open Night');
    expect(res.text).not.toContain('Secret Plans');
    const rainedOff = res.text.split('BEGIN:VEVENT').find((block) => block.includes('SUMMARY:Rained Off'))!;
    expect(rainedOff).toContain('STATUS:CANCELLED');
  });

  it('keeps the same link, and works without signing in', async () => {
    expect(await token(ada)).toBe(await token(ada));
  });

  it("isn't for people outside the club, or a made-up link", async () => {
    await feed(await token(outsider)).expect(404);
    const real = await token(ada);
    await feed(`${real.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAAAA`).expect(404);
    await feed('nonsense').expect(404);
    await feed(real, '00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('a reset turns the old link off', async () => {
    const old = await token(ada);
    const fresh = (await t.api().post('/me/calendar-feed/reset').set('Authorization', ada.auth).expect(200)).body.token;
    expect(fresh).not.toBe(old);
    await feed(old).expect(404);
    await feed(fresh).expect(200);
  });
});
