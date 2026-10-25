import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Paid tickets through Stripe Connect (a fake Stripe here): a workspace
 * connects its account before it can price an event; buying holds a place
 * while they pay; the signed webhook turns it into a ticket, once; giving it
 * back before the cut-off refunds it, and cancelling an event refunds everyone.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;
let bo: TestUser;
let orgId = '';
let slug = '';
let clubId = '';

const inDays = (days: number, hours = 0) => new Date(Date.now() + days * 86_400_000 + hours * 3_600_000).toISOString();
const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
  delete: (path: string) => t.api().delete(path).set('Authorization', u.auth),
});
const webhook = (body: object, signature = 'test') =>
  t.api().post('/payments/webhook').set('stripe-signature', signature).set('Content-Type', 'application/json').send(JSON.stringify(body));
// what Stripe says once someone has paid for the checkout behind `url`
const paid = (url: string, paymentIntentId: string) => {
  const checkout = t.payments.checkouts.find((c) => url.endsWith(c.checkoutId))!;
  return webhook({
    type: 'checkout.completed',
    orgId: checkout.orgId,
    checkoutId: checkout.checkoutId,
    sessionId: `cs_test_${checkout.checkoutId}`,
    paymentIntentId,
  });
};
const paidEvent = async (title: string, body: object = {}) =>
  (
    await as(owner)
      .post(`/clubs/${clubId}/events`, {
        title,
        startsAt: inDays(5),
        endsAt: inDays(5, 3),
        publish: true,
        priceCents: 1500,
        ...body,
      })
      .expect(201)
  ).body;

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  ada = await t.user('Ada');
  bo = await t.user('Bo');
  const org = await as(owner).post('/orgs', { name: `Paid ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  orgId = org.body.id;
  slug = org.body.slug;
  for (const u of [ada, bo]) await as(u).post(`/orgs/by-slug/${slug}/join`).expect(201);
  clubId = (await as(owner).get(`/orgs/${orgId}/clubs`).expect(200)).body[0].id;
});
afterAll(() => t.close());

describe('paid tickets', () => {
  it('says, to anyone, whether payments are on and whether they are for real', async () => {
    // the tests use a pretend gateway: on, and no real money
    expect((await t.api().get('/payments/mode').expect(200)).body).toEqual({ enabled: true, testMode: true });
  });

  it('takes a price only once the workspace has connected Stripe', async () => {
    expect((await as(ada).get(`/orgs/${orgId}/payments`).expect(200)).body).toEqual({
      available: true,
      connected: false,
      ready: false,
      currency: null,
    });
    const refused = await as(owner)
      .post(`/clubs/${clubId}/events`, { title: 'Gala', startsAt: inDays(5), endsAt: inDays(5, 3), priceCents: 1500 })
      .expect(409);
    expect(refused.body.code).toBe('PAYMENTS_NOT_SET_UP');

    // members can't connect it; the owner is sent to Stripe, and back to Settings
    await as(ada).post(`/orgs/${orgId}/payments/connect`).expect(403);
    const link = await as(owner).post(`/orgs/${orgId}/payments/connect`).expect(200);
    expect(decodeURIComponent(link.body.url)).toContain(`/o/${slug}/settings?stripe=return`);
    expect((await as(owner).post(`/orgs/${orgId}/payments/refresh`).expect(200)).body).toEqual({
      available: true,
      connected: true,
      ready: true,
      currency: 'aud',
    });
  });

  it("doesn't hand out a paid place for free", async () => {
    const event = await paidEvent('Gala Dinner');
    expect(event.price).toEqual({ amountCents: 1500, currency: 'aud' });
    const res = await as(ada).post(`/clubs/${clubId}/events/${event.id}/my-registration`).expect(402);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
  });

  it('holds the last place while someone pays, and makes it theirs once Stripe says so', async () => {
    const event = await paidEvent('Small Supper', { capacity: 1 });
    const first = await as(ada).post(`/clubs/${clubId}/events/${event.id}/checkout`).expect(200);
    expect(first.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    // asking again: the same checkout, not a second hold
    expect((await as(ada).post(`/clubs/${clubId}/events/${event.id}/checkout`).expect(200)).body.url).toBe(first.body.url);
    // the only place is held for Ada
    expect((await as(bo).post(`/clubs/${clubId}/events/${event.id}/checkout`).expect(409)).body.code).toBe('EVENT_FULL');

    await paid(first.body.url, 'pi_supper_ada').expect(200);
    await paid(first.body.url, 'pi_supper_ada').expect(200); // Stripe sends it again
    const mine = await as(ada).get(`/clubs/${clubId}/events/${event.id}`).expect(200);
    expect(mine.body).toMatchObject({ youreGoing: true, yourPayment: { amountCents: 1500, currency: 'aud', refundable: true } });
    await vi.waitFor(() =>
      expect(t.mail.sent.filter((e) => e.to === ada.email && e.subject === 'Your ticket: Small Supper')).toHaveLength(1),
    );
    expect((await as(owner).get(`/clubs/${clubId}/events/${event.id}`).expect(200)).body.salesCents).toBe(1500);
    // members don't see the takings
    expect(mine.body.salesCents).toBeNull();

    // sold out, and no waitlist for a paid event
    expect((await as(bo).post(`/clubs/${clubId}/events/${event.id}/waitlist`).expect(409)).body.code).toBe('SOLD_OUT');
  });

  it('refunds a place given back before the cut-off, and frees it for the next buyer', async () => {
    const event = await paidEvent('Wine Tasting', { capacity: 1 });
    const checkout = await as(ada).post(`/clubs/${clubId}/events/${event.id}/checkout`).expect(200);
    await paid(checkout.body.url, 'pi_wine_ada').expect(200);
    await as(ada).delete(`/clubs/${clubId}/events/${event.id}/my-registration`).expect(204);
    expect([...t.payments.refunds.values()]).toContain('pi_wine_ada');
    await as(bo).post(`/clubs/${clubId}/events/${event.id}/checkout`).expect(200);
  });

  it("doesn't refund a place given back after the cut-off", async () => {
    const event = await paidEvent('Late Show', { startsAt: inDays(0, 10), endsAt: inDays(0, 12), refundCutoffHours: 24 });
    const checkout = await as(ada).post(`/clubs/${clubId}/events/${event.id}/checkout`).expect(200);
    await paid(checkout.body.url, 'pi_late_ada').expect(200);
    expect((await as(ada).get(`/clubs/${clubId}/events/${event.id}`).expect(200)).body.yourPayment.refundable).toBe(false);
    await as(ada).delete(`/clubs/${clubId}/events/${event.id}/my-registration`).expect(204);
    expect([...t.payments.refunds.values()]).not.toContain('pi_late_ada');
  });

  it('refunds everyone when the event is cancelled, and a payment that comes in after', async () => {
    const event = await paidEvent('Boat Party');
    const adas = await as(ada).post(`/clubs/${clubId}/events/${event.id}/checkout`).expect(200);
    const bos = await as(bo).post(`/clubs/${clubId}/events/${event.id}/checkout`).expect(200);
    await paid(adas.body.url, 'pi_boat_ada').expect(200);
    await as(owner).post(`/clubs/${clubId}/events/${event.id}/cancel`, {}).expect(201);
    await vi.waitFor(() => expect([...t.payments.refunds.values()]).toContain('pi_boat_ada'));

    // Bo paid as it was being cancelled: there's no place to give, so the money goes back
    await paid(bos.body.url, 'pi_boat_bo').expect(200);
    expect([...t.payments.refunds.values()]).toContain('pi_boat_bo');
    expect((await as(bo).get(`/clubs/${clubId}/events/${event.id}`).expect(200)).body.youreGoing).toBe(false);
  });

  it('sends a guest at a public paid event to pay after confirming their email', async () => {
    const event = await paidEvent('Open Gala', { visibility: 'public' });
    expect((await t.api().get(`/public/events/${event.id}`).expect(200)).body.price).toEqual({ amountCents: 1500, currency: 'aud' });
    const email = `gwen-${t.suffix}@example.com`;
    await t.api().post(`/public/events/${event.id}/places`).send({ name: 'Gwen Guest', email }).expect(202);
    const token = t.mail.sent.filter((e) => e.to === email).at(-1)!.text.match(/confirm\?token=([\w.-]+)/)![1];
    const confirmed = await t.api().post(`/public/events/${event.id}/places/confirm`).send({ token }).expect(200);
    expect(confirmed.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(confirmed.body.ticketToken).toBeUndefined();
    const request = t.payments.checkouts.at(-1)!;
    expect(request.successUrl).toContain(`/e/${event.id}?paid=1`);
    expect(request.email).toBe(email);

    await paid(confirmed.body.checkoutUrl, 'pi_gala_gwen').expect(200);
    await vi.waitFor(() => expect(t.mail.sent.some((e) => e.to === email && e.subject === 'Your ticket: Open Gala')).toBe(true));
  });

  it('acts only on webhooks signed by Stripe', async () => {
    const res = await webhook({ type: 'account.updated', orgId, accountId: 'acct_x', chargesEnabled: false, currency: 'aud' }, 'forged');
    expect(res.status).toBe(400);
    expect((await as(owner).get(`/orgs/${orgId}/payments`).expect(200)).body.ready).toBe(true);
  });
});
