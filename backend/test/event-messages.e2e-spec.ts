import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Organisers message the people going to an event: everyone with a place
 * (guests too), the waitlist if they choose, ten a day at most, and kept.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;
let bo: TestUser;
let cy: TestUser;
let clubId = '';
let eventId = '';
const guestEmail = () => `gwen-${t.suffix}@example.com`;

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  [ada, bo, cy] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  const org = await t.api().post('/orgs').set('Authorization', owner.auth).send({ name: `Msg ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  for (const u of [ada, bo, cy]) await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', u.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', owner.auth).expect(200)).body[0].id;
  const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  eventId = (
    await t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', owner.auth)
      .send({ title: 'Hack Night', startsAt: at(2), endsAt: at(2.1), capacity: 2, visibility: 'public', publish: true })
      .expect(201)
  ).body.id;
  await t.api().post(`/clubs/${clubId}/events/${eventId}/my-registration`).set('Authorization', ada.auth).expect(201);
  // a guest takes the other place
  await t.api().post(`/public/events/${eventId}/places`).send({ name: 'Gwen Guest', email: guestEmail() }).expect(202);
  const link = t.mail.sent.filter((e) => e.to === guestEmail()).at(-1)!.text.match(/confirm\?token=([\w.-]+)/)![1];
  await t.api().post(`/public/events/${eventId}/places/confirm`).send({ token: link }).expect(200);
  // full: Bo waits
  await t.api().post(`/clubs/${clubId}/events/${eventId}/waitlist`).set('Authorization', bo.auth).expect(201);
});
afterAll(() => t.close());

const send = (u: TestUser, body: object) => t.api().post(`/clubs/${clubId}/events/${eventId}/messages`).set('Authorization', u.auth).send(body);
const got = (email: string) => t.mail.sent.filter((e) => e.to === email && e.subject.startsWith('Hack Night: '));

describe('messages to the people going', () => {
  it('reaches everyone with a place, guests too, and keeps the message', async () => {
    const res = await send(owner, { subject: 'Room change', body: 'We are in Hall C.\n\nBring a laptop.' }).expect(201);
    expect(res.body).toMatchObject({ subject: 'Room change', recipientCount: 2, toWaitlist: false, senderName: owner.name });
    await vi.waitFor(() => expect(got(ada.email)).toHaveLength(1), { timeout: 5000 });
    await vi.waitFor(() => expect(got(guestEmail())).toHaveLength(1), { timeout: 5000 });
    const email = got(ada.email)[0];
    expect(email.subject).toBe('Hack Night: Room change');
    expect(email.text).toContain('We are in Hall C.');
    expect(email.text).toContain('Bring a laptop.');
    // the guest's link is the public page, which they can open
    expect(got(guestEmail())[0].text).toContain(`/e/${eventId}`);
    expect(got(bo.email)).toHaveLength(0);
    expect(got(cy.email)).toHaveLength(0);

    const history = await t.api().get(`/clubs/${clubId}/events/${eventId}/messages`).set('Authorization', owner.auth).expect(200);
    expect(history.body.map((m: { subject: string }) => m.subject)).toEqual(['Room change']);
  });

  it('reaches the waitlist too, when asked', async () => {
    await send(owner, { subject: 'Doors at six', body: 'Come early.', toWaitlist: true }).expect(201);
    await vi.waitFor(() => expect(got(bo.email)).toHaveLength(1), { timeout: 5000 });
    expect(got(bo.email)[0].text).toContain('on the waitlist for Hack Night');
  });

  it("is for people who can edit the event, and isn't a firehose", async () => {
    expect((await send(ada, { subject: 'Hi', body: 'Hello' }).expect(403)).body.code).toBe('MISSING_PERMISSION');
    await send(owner, { subject: '', body: 'x' }).expect(400);
    for (let i = 0; i < 8; i++) await send(owner, { subject: `Update ${i}`, body: 'More news.' }).expect(201);
    expect((await send(owner, { subject: 'One more', body: 'Too many.' }).expect(409)).body.code).toBe('TOO_MANY_MESSAGES');
  });
});
