import { DataSource } from 'typeorm';
import { FeedbackService } from '../src/modules/feedback/feedback.service.js';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * "How was it?": a couple of hours after an event, everyone who came in is
 * asked once; the emailed link is their form, no sign-in; organisers see
 * the answers without names.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let feedback: FeedbackService;
// the owner connection: moves the event into the past, which the API (rightly) won't
let owner: DataSource;
let organiser: TestUser;
let ada: TestUser; // came
let bo: TestUser; // came
let cy: TestUser; // registered, didn't come
let clubId = '';
let eventId = '';

const mailTo = (u: TestUser) => t.mail.sent.filter((e) => e.to === u.email && e.subject.startsWith('How was'));
const linkToken = (text: string) => decodeURIComponent(text.match(/feedback\?token=([\w.%-]+)/)![1]);

beforeAll(async () => {
  t = await createTestApp();
  feedback = t.app.get(FeedbackService);
  owner = await new DataSource({ type: 'postgres', url: process.env.MIGRATION_DATABASE_URL }).initialize();
  organiser = await t.user('Olive');
  [ada, bo, cy] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  const org = await t
    .api()
    .post('/orgs')
    .set('Authorization', organiser.auth)
    .send({ name: `Feedback ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  for (const u of [ada, bo, cy]) await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', u.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;
  // running now, so people can be checked in
  const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  eventId = (
    await t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', organiser.auth)
      .send({ title: 'Pottery Night', startsAt: at(-1), endsAt: at(1), publish: true })
      .expect(201)
  ).body.id;
  for (const u of [ada, bo, cy]) {
    await t.api().post(`/clubs/${clubId}/events/${eventId}/my-registration`).set('Authorization', u.auth).expect(201);
  }
  for (const u of [ada, bo]) {
    await t
      .api()
      .post(`/clubs/${clubId}/events/${eventId}/check-in/manual`)
      .set('Authorization', organiser.auth)
      .send({ userId: u.id })
      .expect(200);
  }
});
afterAll(async () => {
  await owner.destroy();
  await t.close();
});

// the event ended `hours` ago
const endedAgo = async (hours: number) => {
  await owner.query(`UPDATE events SET starts_at = now() - make_interval(hours => $2 + 2), ends_at = now() - make_interval(hours => $2) WHERE id = $1`, [
    eventId,
    hours,
  ]);
};

describe('post-event feedback', () => {
  it('waits until a couple of hours after the end, then asks the people who came, once', async () => {
    await endedAgo(1);
    await feedback.requestDue();
    expect(mailTo(ada)).toHaveLength(0);

    await endedAgo(3);
    await feedback.requestDue();
    expect(mailTo(ada)).toHaveLength(1);
    expect(mailTo(bo)).toHaveLength(1);
    expect(mailTo(cy)).toHaveLength(0);
    expect(mailTo(ada)[0].subject).toBe('How was Pottery Night?');

    await feedback.requestDue();
    expect(mailTo(ada)).toHaveLength(1);
  });

  it('takes an answer from the link, and lets it change', async () => {
    const token = linkToken(mailTo(ada)[0].text);
    const form = await t.api().get(`/public/feedback/${token}`).expect(200);
    expect(form.body).toMatchObject({ eventTitle: 'Pottery Night', clubName: 'General', rating: null });

    await t.api().put(`/public/feedback/${token}`).send({ rating: 3 }).expect(200);
    const changed = await t.api().put(`/public/feedback/${token}`).send({ rating: 5, comment: '  Loved the wheel. ' }).expect(200);
    expect(changed.body).toMatchObject({ rating: 5, comment: 'Loved the wheel.' });

    await t.api().put(`/public/feedback/${linkToken(mailTo(bo)[0].text)}`).send({ rating: 2, comment: 'Too crowded' }).expect(200);
    await t.api().put(`/public/feedback/${token}`).send({ rating: 6 }).expect(400);
  });

  it("shows organisers what people thought, without names", async () => {
    const res = await t.api().get(`/clubs/${clubId}/events/${eventId}/feedback`).set('Authorization', organiser.auth).expect(200);
    expect(res.body).toMatchObject({ count: 2, average: 3.5, ratings: [0, 1, 0, 0, 1], asked: 2 });
    expect(res.body.comments.map((c: { comment: string }) => c.comment).sort()).toEqual(['Loved the wheel.', 'Too crowded']);
    expect(JSON.stringify(res.body)).not.toContain(ada.name);
    // members can't see it
    await t.api().get(`/clubs/${clubId}/events/${eventId}/feedback`).set('Authorization', cy.auth).expect(403);
  });

  it('a made-up or altered link gets nowhere', async () => {
    const token = linkToken(mailTo(ada)[0].text);
    await t.api().get(`/public/feedback/${token.slice(0, -2)}xx`).expect(404);
    await t.api().get('/public/feedback/nonsense').expect(404);
  });
});
