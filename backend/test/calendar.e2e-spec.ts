import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * "Add to calendar": the ticket email carries the event as a calendar file,
 * members can download it from the app, and anyone can from a public event's
 * page. One stable ID per event, so adding it again after a change replaces
 * the old entry instead of doubling it.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let organiser: TestUser;
let ada: TestUser;
let outsider: TestUser;
let clubId = '';
let publicId = '';
let membersId = '';

const nextYear = new Date().getUTCFullYear() + 1;

beforeAll(async () => {
  t = await createTestApp();
  organiser = await t.user('Olive');
  ada = await t.user('Ada');
  outsider = await t.user('Otto');
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Calendar ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', ada.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;
  const event = (title: string, visibility: string) =>
    t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', organiser.auth)
      .send({
        title,
        location: 'Hall B; level 2',
        startsAt: `${nextYear}-03-12T09:30:00.000Z`,
        endsAt: `${nextYear}-03-12T12:00:00.000Z`,
        visibility,
        publish: true,
      })
      .expect(201);
  publicId = (await event('Robot Wars, Live', 'public')).body.id;
  membersId = (await event('Members Mixer', 'members')).body.id;
});
afterAll(() => t.close());

describe('add to calendar', () => {
  it('attaches the event to the ticket email', async () => {
    await t.api().post(`/clubs/${clubId}/events/${publicId}/my-registration`).set('Authorization', ada.auth).expect(201);
    const subject = 'Your ticket: Robot Wars, Live';
    await vi.waitFor(() => expect(t.mail.sent.some((e) => e.to === ada.email && e.subject === subject)).toBe(true));
    const email = t.mail.sent.find((e) => e.to === ada.email && e.subject === subject)!;
    const file = email.attachments!.find((a) => a.filename === 'event.ics')!;
    const ics = file.content.toString('utf8');
    expect(ics).toContain(`UID:${publicId}@muster`);
    expect(ics).toContain(`DTSTART:${nextYear}0312T093000Z`);
    expect(ics).toContain('SUMMARY:Robot Wars\\, Live');
    expect(ics).toContain('LOCATION:Hall B\\; level 2');
  });

  it('lets a member download any event they can see', async () => {
    const res = await t
      .api()
      .get(`/clubs/${clubId}/events/${membersId}/calendar`)
      .set('Authorization', ada.auth)
      .buffer(true)
      .expect(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="members-mixer.ics"');
    expect(res.text).toContain(`UID:${membersId}@muster`);
    expect(res.text).toContain('STATUS:CONFIRMED');
  });

  it('keeps it from people outside the club', async () => {
    await t.api().get(`/clubs/${clubId}/events/${membersId}/calendar`).set('Authorization', outsider.auth).expect(403);
  });

  it('gives a public event to anyone, and nothing for a members-only one', async () => {
    const res = await t.api().get(`/public/events/${publicId}/calendar`).buffer(true).expect(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.text).toContain(`UID:${publicId}@muster`);
    expect(res.text).toContain(`/e/${publicId}`);
    const hidden = await t.api().get(`/public/events/${membersId}/calendar`).expect(404);
    expect(hidden.body.code).toBe('EVENT_NOT_FOUND');
  });

  it('marks a cancelled event cancelled, under the same ID', async () => {
    await t
      .api()
      .post(`/clubs/${clubId}/events/${membersId}/cancel`)
      .set('Authorization', organiser.auth)
      .send({})
      .expect(201);
    const res = await t
      .api()
      .get(`/clubs/${clubId}/events/${membersId}/calendar`)
      .set('Authorization', ada.auth)
      .buffer(true)
      .expect(200);
    expect(res.text).toContain(`UID:${membersId}@muster`);
    expect(res.text).toContain('STATUS:CANCELLED');
  });
});
