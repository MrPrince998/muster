import { NotificationService } from '../src/modules/notification/notification.service.js';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * New-event emails, as each member chooses per club: none (the default), one
 * as each event is published, or Monday's digest. Announced once, a series
 * as one, never to whoever made it; and every email turns itself off with
 * one link, no sign-in.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let notifications: NotificationService;
let organiser: TestUser;
let ada: TestUser; // as they're published
let bo: TestUser; // weekly
let cy: TestUser; // never chose: off
let clubId = '';
let draftId = '';

const at = (days: number, hours = 0) => new Date(Date.now() + days * 86_400_000 + hours * 3_600_000).toISOString();
// what they got from clubs (not the sign-up confirmation every test user gets)
const mailTo = (u: TestUser) => t.mail.sent.filter((e) => e.to === u.email && !e.subject.startsWith('Confirm your email'));
const stopToken = (text: string) => decodeURIComponent(text.match(/unsubscribe\?token=([\w.%-]+)/)![1]);

beforeAll(async () => {
  t = await createTestApp();
  notifications = t.app.get(NotificationService);
  organiser = await t.user('Olive');
  [ada, bo, cy] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Mail ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  for (const u of [ada, bo, cy]) await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', u.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;
  // the organiser hears straight away too, but never about their own events
  for (const [u, choice] of [[ada, 'instant'], [bo, 'weekly'], [organiser, 'instant']] as const) {
    await t.api().put(`/clubs/${clubId}/event-emails`).set('Authorization', u.auth).send({ eventEmails: choice }).expect(200);
  }
});
afterAll(() => t.close());

const create = (body: object) =>
  t.api().post(`/clubs/${clubId}/events`).set('Authorization', organiser.auth).send(body).expect(201);

describe('new-event emails', () => {
  it('starts off, and takes only a real choice', async () => {
    const res = await t.api().get(`/clubs/${clubId}/event-emails`).set('Authorization', cy.auth).expect(200);
    expect(res.body.eventEmails).toBe('off');
    expect((await t.api().get(`/clubs/${clubId}/event-emails`).set('Authorization', ada.auth).expect(200)).body.eventEmails).toBe(
      'instant',
    );
    await t.api().put(`/clubs/${clubId}/event-emails`).set('Authorization', cy.auth).send({ eventEmails: 'hourly' }).expect(400);
  });

  it('announces a published event once, to those who asked, and a series as one', async () => {
    await create({ title: 'Open Night', location: 'Hall A', startsAt: at(3), endsAt: at(3, 2), publish: true });
    await create({ title: 'Build Night', startsAt: at(2), endsAt: at(2, 2), publish: true, repeat: { every: 'week', count: 3 } });
    draftId = (await create({ title: 'Secret Plans', startsAt: at(4), endsAt: at(4, 1) })).body.id;

    await notifications.announce();
    const adas = mailTo(ada);
    expect(adas.map((e) => e.subject).sort()).toEqual(['New in General: Build Night', 'New in General: Open Night']);
    expect(adas.find((e) => e.subject.endsWith('Build Night'))!.text).toContain('Repeats: Every week, 3 times');
    expect(adas[0].headers).toMatchObject({ 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(adas[0].headers!['List-Unsubscribe']).toMatch(/^<http.+\/unsubscribe\/one-click\?token=.+>$/);
    // not the one who made them, not the weekly one, not the one who never chose
    expect(mailTo(organiser).filter((e) => e.subject.startsWith('New in'))).toHaveLength(0);
    expect(mailTo(bo)).toHaveLength(0);
    expect(mailTo(cy)).toHaveLength(0);

    // nothing twice
    await notifications.announce();
    expect(mailTo(ada)).toHaveLength(2);
  });

  it('announces a draft once it is published', async () => {
    await t.api().post(`/clubs/${clubId}/events/${draftId}/publish`).set('Authorization', organiser.auth).expect(201);
    await notifications.announce();
    expect(mailTo(ada).map((e) => e.subject)).toContain('New in General: Secret Plans');
  });

  it("sends the weekly digest of the next two weeks, once a week", async () => {
    await notifications.sendDigests({ anyDay: true });
    const digest = mailTo(bo).find((e) => e.subject.startsWith('Coming up in'))!;
    expect(digest.subject).toBe(`Coming up in Mail ${t.suffix}`);
    expect(digest.text).toMatch(/New: \w{3} \d{1,2} \w{3}, \d{2}:\d{2}: Build Night \(General\)/);
    expect(digest.text).toContain('Open Night (General)');
    // the 3rd Build Night is more than two weeks out
    expect(digest.text.match(/Build Night/g)).toHaveLength(2);

    await notifications.sendDigests({ anyDay: true });
    expect(mailTo(bo).filter((e) => e.subject.startsWith('Coming up in'))).toHaveLength(1);
  });

  it('turns itself off from the link in the email, no sign-in needed', async () => {
    const fromClub = await t.api().post('/public/event-emails/off').send({ token: stopToken(mailTo(ada)[0].text) }).expect(200);
    expect(fromClub.body.stopped).toBe('New-event emails from General');
    expect((await t.api().get(`/clubs/${clubId}/event-emails`).set('Authorization', ada.auth).expect(200)).body.eventEmails).toBe(
      'off',
    );

    const digest = mailTo(bo).find((e) => e.subject.startsWith('Coming up in'))!;
    const fromDigest = await t.api().post('/public/event-emails/off').send({ token: stopToken(digest.text) }).expect(200);
    expect(fromDigest.body.stopped).toBe(`The weekly digest from Mail ${t.suffix}`);
    expect((await t.api().get(`/clubs/${clubId}/event-emails`).set('Authorization', bo.auth).expect(200)).body.eventEmails).toBe(
      'off',
    );

    // a changed link does nothing
    const forged = stopToken(mailTo(ada)[0].text).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    await t.api().post('/public/event-emails/off').send({ token: forged }).expect(400);
  });
});
