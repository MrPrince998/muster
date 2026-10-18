import { DataSource } from 'typeorm';
import { ReminderService } from '../src/modules/registration/reminder.service.js';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * The day-before reminder: who gets one (a place taken well before the
 * event), who doesn't (a place taken within the day, cancelled, events
 * further off or cancelled), guests' links, once only, and retrying a send
 * that failed.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: DataSource;
let reminders: ReminderService;
let organiser: TestUser;
let ada: TestUser;
let bo: TestUser;
let cy: TestUser;
let clubId = '';
const ev = { soon: '', later: '', off: '' };
const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const guestEmail = () => `gwen-${t.suffix}@example.com`;

// pretend a place was taken days ago (only the schema owner can write that)
const backdate = (eventId: string, userEmail: string) =>
  owner.query(
    `UPDATE registrations SET created_at = now() - interval '3 days'
     WHERE event_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
    [eventId, userEmail],
  );
const remindersTo = (email: string) => t.mail.sent.filter((e) => e.to === email && e.subject.startsWith('Coming up'));

beforeAll(async () => {
  t = await createTestApp();
  owner = await new DataSource({ type: 'postgres', url: process.env.MIGRATION_DATABASE_URL }).initialize();
  reminders = t.app.get(ReminderService);
  organiser = await t.user('Olive');
  [ada, bo, cy] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Remind ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  for (const u of [ada, bo, cy]) await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', u.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;

  const make = async (title: string, startHours: number, extra: object = {}) =>
    (
      await t
        .api()
        .post(`/clubs/${clubId}/events`)
        .set('Authorization', organiser.auth)
        .send({ title, startsAt: at(startHours), endsAt: at(startHours + 3), publish: true, location: 'Hall B', ...extra })
        .expect(201)
    ).body.id as string;
  ev.soon = await make('Demo Night', 20, { visibility: 'public' });
  ev.later = await make('Quiz Night', 72);
  ev.off = await make('Outdoor Race', 20);

  const register = (u: TestUser, eventId: string) =>
    t.api().post(`/clubs/${clubId}/events/${eventId}/my-registration`).set('Authorization', u.auth).expect(201);
  // Ada: well ahead, so due. Bo: only just registered, so not. Cy: cancelled.
  await register(ada, ev.soon);
  await backdate(ev.soon, ada.email);
  await register(bo, ev.soon);
  await register(cy, ev.soon);
  await backdate(ev.soon, cy.email);
  await t.api().delete(`/clubs/${clubId}/events/${ev.soon}/my-registration`).set('Authorization', cy.auth).expect(204);
  // Ada elsewhere: an event too far off, and one that was called off
  await register(ada, ev.later);
  await backdate(ev.later, ada.email);
  await register(ada, ev.off);
  await backdate(ev.off, ada.email);
  await t.api().post(`/clubs/${clubId}/events/${ev.off}/cancel`).set('Authorization', organiser.auth).send({}).expect(201);

  // a guest, through the public page, also well ahead
  await t.api().post(`/public/events/${ev.soon}/places`).send({ name: 'Gwen', email: guestEmail() }).expect(202);
  const link = t.mail.sent.filter((e) => e.to === guestEmail()).at(-1)!.text.match(/confirm\?token=([\w.-]+)/)![1];
  await t.api().post(`/public/events/${ev.soon}/places/confirm`).send({ token: link }).expect(200);
  await backdate(ev.soon, guestEmail());
});

afterAll(async () => {
  await owner.destroy();
  await t.close();
});

describe('day-before reminders', () => {
  it('reminds places taken well ahead, and nobody else', async () => {
    expect(await reminders.sendDue()).toBe(2);
    expect(remindersTo(ada.email).map((e) => e.subject)).toEqual(['Coming up: Demo Night']);
    expect(remindersTo(guestEmail())).toHaveLength(1);
    // just registered, cancelled: no reminder
    expect(remindersTo(bo.email)).toEqual([]);
    expect(remindersTo(cy.email)).toEqual([]);
  });

  it('carries the ticket, and the right way back to it', async () => {
    const [member] = remindersTo(ada.email);
    expect(member.attachments?.[0].filename).toBe('ticket.png');
    expect(member.text).toContain('/tickets?ticket=');
    expect(member.text).toContain('Where: Hall B');
    expect(member.idempotencyKey).toMatch(/^event-reminder\//);

    // a guest can't sign in: the link opens the ticket itself
    const [guest] = remindersTo(guestEmail());
    const token = guest.text.match(/\/t\/([\w.-]+)/)![1];
    await t.api().get(`/public/tickets/${token}`).expect(200);
  });

  it('goes out once', async () => {
    expect(await reminders.sendDue()).toBe(0);
    expect(remindersTo(ada.email)).toHaveLength(1);
  });

  it('tries a failed send again next time', async () => {
    // Bo's place, now as if taken days ago, and the email provider down
    await backdate(ev.soon, bo.email);
    const send = t.mail.send.bind(t.mail);
    t.mail.send = () => Promise.reject(new Error('provider down'));
    try {
      expect(await reminders.sendDue()).toBe(0);
    } finally {
      t.mail.send = send;
    }
    expect(remindersTo(bo.email)).toEqual([]);
    // back up: the next round sends it
    expect(await reminders.sendDue()).toBe(1);
    expect(remindersTo(bo.email)).toHaveLength(1);
  });
});
