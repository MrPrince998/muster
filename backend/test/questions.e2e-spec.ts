import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Registration questions: an event asks up to five (text, or a choice), and
 * every way of taking a place asks them: registering, the waitlist (answers
 * go with the place when it comes), a guest's emailed link, and paying. The
 * answers show in the attendee list and the spreadsheet.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;
let bo: TestUser;
let orgId = '';
let clubId = '';
let eventId = '';
let diet = '';
let note = '';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
  patch: (path: string, body: object) => t.api().patch(path).set('Authorization', u.auth).send(body),
  delete: (path: string) => t.api().delete(path).set('Authorization', u.auth),
});
const attendees = async () =>
  (await as(owner).get(`/clubs/${clubId}/events/${eventId}/registrations`).expect(200)).body.attendees as {
    name: string;
    answers: Record<string, string>;
  }[];

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  ada = await t.user('Ada');
  bo = await t.user('Bo');
  const org = await as(owner).post('/orgs', { name: `Questions ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  orgId = org.body.id;
  for (const u of [ada, bo]) await as(u).post(`/orgs/by-slug/${org.body.slug}/join`).expect(201);
  clubId = (await as(owner).get(`/orgs/${orgId}/clubs`).expect(200)).body[0].id;
  const event = await as(owner)
    .post(`/clubs/${clubId}/events`, {
      title: 'Curry Night',
      startsAt: inDays(3),
      endsAt: inDays(3.1),
      capacity: 2,
      visibility: 'public',
      publish: true,
      questions: [
        { label: 'Dietary needs', kind: 'choice', options: ['None', 'Vegetarian', 'Vegan'], required: true },
        { label: 'Anything else?', kind: 'text' },
      ],
    })
    .expect(201);
  eventId = event.body.id;
  [diet, note] = event.body.questions.map((q: { id: string }) => q.id);
});
afterAll(() => t.close());

describe('registration questions', () => {
  it('asks them when registering, and won\'t take a place without the required ones', async () => {
    const refused = await as(ada).post(`/clubs/${clubId}/events/${eventId}/my-registration`).expect(400);
    expect(refused.body.code).toBe('INVALID_ANSWERS');
    expect(refused.body.details.problems).toEqual([{ questionId: diet, label: 'Dietary needs', problem: 'required' }]);
    await as(ada).post(`/clubs/${clubId}/events/${eventId}/my-registration`, { answers: { [diet]: 'Steak' } }).expect(400);

    await as(ada)
      .post(`/clubs/${clubId}/events/${eventId}/my-registration`, { answers: { [diet]: 'Vegan', [note]: ' Nut allergy ' } })
      .expect(201);
    expect((await attendees()).find((a) => a.name === ada.name)!.answers).toEqual({ [diet]: 'Vegan', [note]: 'Nut allergy' });
  });

  it("asks a guest on the event's page, and keeps the answers through the emailed link", async () => {
    const email = `gwen-${t.suffix}@example.com`;
    const event = await t.api().get(`/public/events/${eventId}`).expect(200);
    expect(event.body.questions.map((q: { label: string }) => q.label)).toEqual(['Dietary needs', 'Anything else?']);
    await t.api().post(`/public/events/${eventId}/places`).send({ name: 'Gwen Guest', email }).expect(400);
    await t.api().post(`/public/events/${eventId}/places`).send({ name: 'Gwen Guest', email, answers: { [diet]: 'Vegetarian' } }).expect(202);
    const token = t.mail.sent.filter((e) => e.to === email).at(-1)!.text.match(/confirm\?token=([\w.-]+)/)![1];
    await t.api().post(`/public/events/${eventId}/places/confirm`).send({ token }).expect(200);
    expect((await attendees()).find((a) => a.name === 'Gwen Guest')!.answers).toEqual({ [diet]: 'Vegetarian' });
  });

  it('takes answers on the waitlist, and they come with the place', async () => {
    // full now (Ada and Gwen): Bo waits, answering
    await as(bo).post(`/clubs/${clubId}/events/${eventId}/waitlist`).expect(400);
    await as(bo).post(`/clubs/${clubId}/events/${eventId}/waitlist`, { answers: { [diet]: 'None' } }).expect(201);
    await as(ada).delete(`/clubs/${clubId}/events/${eventId}/my-registration`).expect(204);
    expect((await attendees()).find((a) => a.name === bo.name)!.answers).toEqual({ [diet]: 'None' });
  });

  it('puts a column per question in the spreadsheet', async () => {
    const csv = (await as(owner).get(`/clubs/${clubId}/events/${eventId}/registrations/export`).buffer(true).expect(200)).text;
    const [header, ...rows] = csv.replace('﻿', '').trim().split('\r\n');
    expect(header).toMatch(/,Dietary needs,Anything else\?$/);
    expect(rows.find((r) => r.startsWith('Gwen Guest'))).toMatch(/,Vegetarian,$/);
  });

  it('keeps answers with a question when it is edited, and a new question starts empty', async () => {
    const edited = await as(owner)
      .patch(`/clubs/${clubId}/events/${eventId}`, {
        questions: [
          { id: diet, label: 'Food', kind: 'choice', options: ['None', 'Vegetarian', 'Vegan', 'Halal'], required: true },
          { label: 'T-shirt size', kind: 'choice', options: ['S', 'M', 'L'] },
        ],
      })
      .expect(200);
    expect(edited.body.questions[0]).toMatchObject({ id: diet, label: 'Food' });
    expect(edited.body.questions[1].id).not.toBe(note);
    expect((await attendees()).find((a) => a.name === 'Gwen Guest')!.answers[diet]).toBe('Vegetarian');
  });

  it('refuses a choice question without choices', async () => {
    const res = await as(owner)
      .patch(`/clubs/${clubId}/events/${eventId}`, { questions: [{ label: 'Size', kind: 'choice', options: ['M'] }] })
      .expect(400);
    expect(res.body.code).toBe('QUESTION_NEEDS_CHOICES');
  });

  it('asks them when buying, and the answers come with the paid place', async () => {
    await as(owner).post(`/orgs/${orgId}/payments/connect`).expect(200);
    await as(owner).post(`/orgs/${orgId}/payments/refresh`).expect(200);
    const paid = await as(owner)
      .post(`/clubs/${clubId}/events`, {
        title: 'Supper Club',
        startsAt: inDays(4),
        endsAt: inDays(4.1),
        publish: true,
        priceCents: 2000,
        questions: [{ label: 'Course', kind: 'choice', options: ['Fish', 'Veg'], required: true }],
      })
      .expect(201);
    const course = paid.body.questions[0].id;
    await as(ada).post(`/clubs/${clubId}/events/${paid.body.id}/checkout`).expect(400);
    const checkout = await as(ada).post(`/clubs/${clubId}/events/${paid.body.id}/checkout`, { answers: { [course]: 'Fish' } }).expect(200);
    const request = t.payments.checkouts.find((c) => checkout.body.url.endsWith(c.checkoutId))!;
    await t
      .api()
      .post('/payments/webhook')
      .set('stripe-signature', 'test')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          type: 'checkout.completed',
          orgId: request.orgId,
          checkoutId: request.checkoutId,
          sessionId: `cs_test_${request.checkoutId}`,
          paymentIntentId: 'pi_supper',
        }),
      )
      .expect(200);
    const page = (await as(owner).get(`/clubs/${clubId}/events/${paid.body.id}/registrations`).expect(200)).body;
    expect(page.attendees[0].answers).toEqual({ [course]: 'Fish' });
    // the tally counts it, over everyone going
    expect(page.tallies.find((x: { questionId: string }) => x.questionId === course)).toMatchObject({ answered: 1, options: { Fish: 1 } });
  });
});
