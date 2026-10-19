import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * The attendee list as a spreadsheet: who's going, who came in, who's from
 * outside, the waitlist; safe to open (no formula runs), and no more than the
 * app shows organisers (no email addresses).
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let organiser: TestUser;
let ada: TestUser;
let bo: TestUser;
let eve: TestUser;
let clubId = '';
let eventId = '';

beforeAll(async () => {
  t = await createTestApp();
  organiser = await t.user('Olive');
  [ada, bo, eve] = [await t.user('Ada'), await t.user('Bo'), await t.user('Eve')];
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Export ${t.suffix}`, joinPolicy: 'open', timeZone: 'Asia/Tokyo' })
    .expect(201);
  for (const u of [ada, bo, eve]) await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', u.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;
  // running now (so people can be checked in), with three places
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  eventId = (
    await t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', organiser.auth)
      .send({ title: 'Robot Wars: Viewing!', startsAt: at(-30), endsAt: at(120), capacity: 3, visibility: 'public', publish: true })
      .expect(201)
  ).body.id;

  // Bo's name is a spreadsheet formula: it must arrive as text
  await t.api().patch('/auth/me').set('Authorization', bo.auth).send({ name: '=HYPERLINK("http://evil.example","Bo")' }).expect(200);
  const register = (u: TestUser) =>
    t.api().post(`/clubs/${clubId}/events/${eventId}/my-registration`).set('Authorization', u.auth).expect(201);
  await register(ada);
  await register(bo);
  // a guest from outside, through the public page
  const guestEmail = `gwen-${t.suffix}@example.com`;
  await t.api().post(`/public/events/${eventId}/places`).send({ name: 'Gwen Guest', email: guestEmail }).expect(202);
  const link = t.mail.sent.filter((e) => e.to === guestEmail).at(-1)!.text.match(/confirm\?token=([\w.-]+)/)![1];
  await t.api().post(`/public/events/${eventId}/places/confirm`).send({ token: link }).expect(200);
  // full now: Eve waits
  await t.api().post(`/clubs/${clubId}/events/${eventId}/waitlist`).set('Authorization', eve.auth).expect(201);
  // Ada came in
  const ticket = await t.api().get(`/clubs/${clubId}/events/${eventId}/my-ticket`).set('Authorization', ada.auth).expect(200);
  await t
    .api()
    .post(`/clubs/${clubId}/events/${eventId}/check-in`)
    .set('Authorization', organiser.auth)
    .send({ token: ticket.body.token })
    .expect(200);
});
afterAll(() => t.close());

const download = (u: TestUser) =>
  t.api().get(`/clubs/${clubId}/events/${eventId}/registrations/export`).set('Authorization', u.auth).buffer(true);

describe('attendee export', () => {
  it('downloads a CSV named after the event, never cached', async () => {
    const res = await download(organiser).expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="robot-wars-viewing-attendees.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text.startsWith('﻿')).toBe(true);
  });

  it('lists who came, who is going, guests and the waitlist, in the workspace zone', async () => {
    const rows = (await download(organiser).expect(200)).text.replace('﻿', '').trim().split('\r\n');
    expect(rows[0]).toBe('Name,Status,Registered (Asia/Tokyo),Checked in (Asia/Tokyo),From outside the workspace');
    const line = (name: string) => rows.find((r) => r.includes(name))!;
    expect(line('Ada')).toMatch(/^Ada,Checked in,\d{4}-\d{2}-\d{2} \d{2}:\d{2},\d{4}-\d{2}-\d{2} \d{2}:\d{2},No$/);
    expect(line('Gwen Guest')).toMatch(/^Gwen Guest,Going,\d{4}-\d{2}-\d{2} \d{2}:\d{2},,Yes$/);
    expect(rows.at(-1)).toMatch(/^Eve,Waitlist 1,\d{4}-\d{2}-\d{2} \d{2}:\d{2},,No$/);
    expect(rows).toHaveLength(5);
  });

  it("defuses a name that's a formula, and shows no email addresses", async () => {
    const text = (await download(organiser).expect(200)).text;
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""Bo"")",Going`);
    expect(text).not.toContain('@example.com');
  });

  it('is only for people who can see the attendee list', async () => {
    const res = await download(ada).expect(403);
    expect(res.body.code).toBe('MISSING_PERMISSION');
  });
});
