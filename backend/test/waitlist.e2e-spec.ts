import { DataSource } from 'typeorm';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Waitlists: joining only when full, the queue's order, places going to the
 * longest-waiting automatically (on a place given back, or more capacity),
 * nobody jumping the queue, guests waiting through the public page, leaving,
 * and the waiting being told when an event is called off.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: DataSource;
let organiser: TestUser;
let ada: TestUser;
let bo: TestUser;
let cy: TestUser;
let dee: TestUser;
let eve: TestUser;
let clubId = '';
let eventId = '';
const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const guestEmail = () => `gwen-${t.suffix}@example.com`;

const E = (path = '') => `/clubs/${clubId}/events/${eventId}${path}`;
const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
  patch: (path: string, body: object) => t.api().patch(path).set('Authorization', u.auth).send(body),
  delete: (path: string) => t.api().delete(path).set('Authorization', u.auth),
});
const event = async (u: TestUser) => (await as(u).get(E()).expect(200)).body;
const emailsTo = (to: string, subject: string) => t.mail.sent.filter((e) => e.to === to && e.subject.startsWith(subject));

beforeAll(async () => {
  t = await createTestApp();
  owner = await new DataSource({ type: 'postgres', url: process.env.MIGRATION_DATABASE_URL }).initialize();
  organiser = await t.user('Olive');
  [ada, bo, cy, dee, eve] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy'), await t.user('Dee'), await t.user('Eve')];
  const org = await as(organiser).post('/orgs', { name: `Queue ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  for (const u of [ada, bo, cy, dee, eve]) await as(u).post(`/orgs/by-slug/${org.body.slug}/join`).expect(201);
  clubId = (await as(organiser).get(`/orgs/${org.body.id}/clubs`).expect(200)).body[0].id;
  eventId = (
    await as(organiser)
      .post(`/clubs/${clubId}/events`, {
        title: 'Robot Wars',
        startsAt: at(48),
        endsAt: at(51),
        capacity: 1,
        visibility: 'public',
        publish: true,
      })
      .expect(201)
  ).body.id;
});

afterAll(async () => {
  await owner.destroy();
  await t.close();
});

describe('waitlists', () => {
  it('opens only once the event is full', async () => {
    expect((await as(bo).post(E('/waitlist'))).body.code).toBe('PLACES_AVAILABLE');
    await as(ada).post(E('/my-registration')).expect(201);
    expect((await as(bo).post(E('/my-registration'))).body.code).toBe('EVENT_FULL');
  });

  it('queues in the order people join, and says where you are', async () => {
    expect((await as(bo).post(E('/waitlist')).expect(201)).body.position).toBe(1);
    expect((await as(cy).post(E('/waitlist')).expect(201)).body.position).toBe(2);
    // joining twice keeps your place; someone with a place can't join
    expect((await as(bo).post(E('/waitlist')).expect(201)).body.position).toBe(1);
    expect((await as(ada).post(E('/waitlist'))).body.code).toBe('ALREADY_REGISTERED');

    expect(await event(bo)).toMatchObject({ waitlistCount: 2, yourWaitlistPosition: 1, youreGoing: false });
    expect(await event(cy)).toMatchObject({ yourWaitlistPosition: 2 });
    expect(await event(dee)).toMatchObject({ yourWaitlistPosition: null });
  });

  it('gives a place given back to whoever waited longest, ticket and all', async () => {
    await as(ada).delete(E('/my-registration')).expect(204);
    expect(await event(bo)).toMatchObject({ youreGoing: true, yourWaitlistPosition: null, registeredCount: 1 });
    expect(await event(cy)).toMatchObject({ youreGoing: false, yourWaitlistPosition: 1, waitlistCount: 1 });
    await vi.waitFor(() => expect(emailsTo(bo.email, 'A place opened up: Robot Wars')).toHaveLength(1));
    expect(emailsTo(bo.email, 'A place opened up')[0].attachments?.[0].filename).toBe('ticket.png');
  });

  it("won't let a newcomer take a free place while people are waiting", async () => {
    // a place frees up out of band (no promotion has run yet), with Cy still waiting
    await owner.query(`UPDATE events SET capacity = 2 WHERE id = $1`, [eventId]);
    expect((await as(dee).post(E('/my-registration'))).body.code).toBe('EVENT_FULL');
    expect((await as(dee).post(E('/waitlist')).expect(201)).body.position).toBe(2);
    await owner.query(`UPDATE events SET capacity = 1 WHERE id = $1`, [eventId]);
  });

  it('hands out as many places as a higher capacity makes, in order', async () => {
    // Bo has the one place; Cy (1) and Dee (2) wait. Room for one more:
    const res = await as(organiser).patch(E(), { capacity: 2 }).expect(200);
    expect(res.body).toMatchObject({ registeredCount: 2, waitlistCount: 1 });
    expect(await event(cy)).toMatchObject({ youreGoing: true });
    expect(await event(dee)).toMatchObject({ youreGoing: false, yourWaitlistPosition: 1 });
  });

  it('lets you leave the queue', async () => {
    await as(dee).delete(E('/waitlist')).expect(204);
    expect((await as(dee).delete(E('/waitlist'))).body.code).toBe('NOT_WAITLISTED');
    expect(await event(organiser)).toMatchObject({ waitlistCount: 0 });
  });

  it('takes guests through the public page: confirming a full event joins the queue', async () => {
    // full again (Bo and Cy hold both places)
    const page = await t.api().get(`/public/events/${eventId}`).expect(200);
    expect(page.body).toMatchObject({ placesLeft: 0, waitlistCount: 0 });

    await t.api().post(`/public/events/${eventId}/places`).send({ name: 'Gwen', email: guestEmail() }).expect(202);
    const [invite] = emailsTo(guestEmail(), 'Join the waitlist');
    const link = invite.text.match(/confirm\?token=([\w.-]+)/)![1];
    const joined = await t.api().post(`/public/events/${eventId}/places/confirm`).send({ token: link }).expect(200);
    expect(joined.body).toEqual({ waitlistPosition: 1 });
    // clicked again: still once in the queue
    expect((await t.api().post(`/public/events/${eventId}/places/confirm`).send({ token: link }).expect(200)).body).toEqual({
      waitlistPosition: 1,
    });

    // a place frees: the guest gets it, and a link to the ticket's own page
    await as(cy).delete(E('/my-registration')).expect(204);
    await vi.waitFor(() => expect(emailsTo(guestEmail(), 'A place opened up')).toHaveLength(1));
    const token = emailsTo(guestEmail(), 'A place opened up')[0].text.match(/\/t\/([\w.-]+)/)![1];
    await t.api().get(`/public/tickets/${token}`).expect(200);
  });

  it('tells the people waiting when the event is called off', async () => {
    await as(eve).post(E('/waitlist')).expect(201);
    await as(organiser).post(E('/cancel'), { reason: 'Venue flooded' }).expect(201);
    // the cancellation emails go out paced (the provider's rate limit); the waiting come after the registered
    await vi.waitFor(() => expect(emailsTo(eve.email, 'Cancelled: Robot Wars')).toHaveLength(1), { timeout: 5000 });
    expect(emailsTo(eve.email, 'Cancelled')[0].text).toContain('Venue flooded');
  });
});
