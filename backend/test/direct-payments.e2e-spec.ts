import { DataSource } from 'typeorm';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Paying the organisers directly, for workspaces Stripe can't serve: they
 * say how to pay them; a buyer's place is held with a reference while they
 * pay; an organiser marks it paid (the ticket follows) or turns it down (the
 * place goes back on offer). Muster never touches the money.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;
let bo: TestUser;
let cy: TestUser;
let orgId = '';
let clubId = '';
// the schema owner, past RLS: to wind a hold's clock forward
let db: DataSource;

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const inDays = (days: number, hours = 0) => new Date(Date.now() + days * 86_400_000 + hours * 3_600_000).toISOString();
const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
  patch: (path: string, body: object) => t.api().patch(path).set('Authorization', u.auth).send(body),
  delete: (path: string) => t.api().delete(path).set('Authorization', u.auth),
});
const paidEvent = async (title: string, body: object = {}) =>
  (
    await as(owner)
      .post(`/clubs/${clubId}/events`, {
        title,
        startsAt: inDays(5),
        endsAt: inDays(5, 3),
        publish: true,
        priceCents: 50000,
        ...body,
      })
      .expect(201)
  ).body as { id: string };
const buy = (u: TestUser, eventId: string) => as(u).post(`/clubs/${clubId}/events/${eventId}/checkout`);
const pending = async (eventId: string) =>
  (await as(owner).get(`/clubs/${clubId}/events/${eventId}/direct-payments`).expect(200)).body as {
    id: string;
    name: string;
    reference: string;
    expired: boolean;
  }[];
const event = async (u: TestUser, eventId: string) => (await as(u).get(`/clubs/${clubId}/events/${eventId}`).expect(200)).body;

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  [ada, bo, cy] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy')];
  const org = await as(owner).post('/orgs', { name: `Direct ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  orgId = org.body.id;
  for (const u of [ada, bo, cy]) await as(u).post(`/orgs/by-slug/${org.body.slug}/join`).expect(201);
  clubId = (await as(owner).get(`/orgs/${orgId}/clubs`).expect(200)).body[0].id;
  db = await new DataSource({ type: 'postgres', url: process.env.MIGRATION_DATABASE_URL }).initialize();
});
afterAll(async () => {
  await db?.destroy();
  await t.close();
});

describe('setting up direct payments', () => {
  it("is the owner's and admins' to set, and needs instructions and a currency", async () => {
    await as(ada).patch(`/orgs/${orgId}/payments`, { method: 'direct' }).expect(403);
    expect((await as(owner).patch(`/orgs/${orgId}/payments`, { method: 'direct' }).expect(400)).body.code).toBe(
      'DIRECT_DETAILS_REQUIRED',
    );
    await as(owner).patch(`/orgs/${orgId}/payments`, { method: 'direct', currency: 'xyz', instructions: 'x' }).expect(400);

    const set = await as(owner)
      .patch(`/orgs/${orgId}/payments`, {
        method: 'direct',
        currency: 'npr',
        instructions: 'eSewa: 9800000000 (Robotics Club)',
        holdHours: 24,
      })
      .expect(200);
    expect(set.body).toMatchObject({
      method: 'direct',
      ready: true,
      currency: 'npr',
      direct: { currency: 'npr', instructions: 'eSewa: 9800000000 (Robotics Club)', qrUrl: null, holdHours: 24 },
    });
    // any member can see how the workspace is paid
    expect((await as(ada).get(`/orgs/${orgId}/payments`).expect(200)).body).toMatchObject({ method: 'direct', ready: true });
  });

  it('takes a QR code to show people paying', async () => {
    await t.api().put(`/orgs/${orgId}/payments/qr`).set('Authorization', ada.auth).set('Content-Type', 'image/png').send(png).expect(403);
    const res = await t
      .api()
      .put(`/orgs/${orgId}/payments/qr`)
      .set('Authorization', owner.auth)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(200);
    expect(res.body.direct.qrUrl).toMatch(/^\/files\/qr\/[0-9a-f-]{36}\.png$/);
    const file = await t.api().get(res.body.direct.qrUrl).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    // a new one replaces it, and the old one goes
    const again = await t
      .api()
      .put(`/orgs/${orgId}/payments/qr`)
      .set('Authorization', owner.auth)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(200);
    await t.api().get(res.body.direct.qrUrl).expect(404);
    await t.api().get(again.body.direct.qrUrl).expect(200);
  });

  it('prices events in its currency', async () => {
    const ev = await paidEvent('Price Check');
    expect((await event(owner, ev.id)).price).toEqual({ amountCents: 50000, currency: 'npr' });
  });
});

describe('buying a place', () => {
  let eventId = '';
  let reference = '';

  beforeAll(async () => {
    eventId = (await paidEvent('Robot Wars', { capacity: 1 })).id;
  });

  it('holds the place with a reference and says how to pay, by email too', async () => {
    const res = await buy(ada, eventId).expect(200);
    expect(res.body).toMatchObject({
      url: null,
      registered: false,
      payment: {
        amountCents: 50000,
        currency: 'npr',
        instructions: 'eSewa: 9800000000 (Robotics Club)',
        qrUrl: expect.stringMatching(/^\/files\/qr\//),
        ticketType: 'General admission',
      },
    });
    reference = res.body.payment.reference;
    expect(reference).toMatch(/^[A-Z2-9]{6}$/);
    // held for the workspace's 24 hours
    const hours = (new Date(res.body.payment.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);

    await vi.waitFor(() => {
      const email = t.mail.sent.find((e) => e.to === ada.email && e.subject === 'Pay for your ticket: Robot Wars');
      expect(email?.text).toContain(`Put this reference on the payment: ${reference}`);
      expect(email?.text).toContain('Pay NPR 500.00 to the organisers:');
      expect(email?.text).toContain('eSewa: 9800000000 (Robotics Club)');
      expect(email?.attachments?.map((a) => a.filename)).toEqual(['payment-qr.png']);
    });
    // no Stripe involved
    expect(t.payments.checkouts.some((c) => c.title.startsWith('Robot Wars'))).toBe(false);
  });

  it('asking again gives the same hold, and the event shows it', async () => {
    expect((await buy(ada, eventId).expect(200)).body.payment.reference).toBe(reference);
    const mine = await event(ada, eventId);
    expect(mine).toMatchObject({ youreGoing: false, heldCount: 1, yourPendingPayment: { reference }, paymentsToConfirm: 0 });
    // the only place is Ada's while she pays
    expect((await buy(bo, eventId).expect(409)).body.code).toBe('EVENT_FULL');
    expect((await event(owner, eventId)).paymentsToConfirm).toBe(1);
  });

  it("lists it for the organisers, and only them", async () => {
    await as(bo).get(`/clubs/${clubId}/events/${eventId}/direct-payments`).expect(403);
    expect(await pending(eventId)).toMatchObject([{ name: ada.name, reference, expired: false }]);
  });

  it('gives the place and the ticket once an organiser says the money came, once', async () => {
    const [p] = await pending(eventId);
    await as(bo).post(`/clubs/${clubId}/events/${eventId}/direct-payments/${p.id}/confirm`).expect(403);
    await as(owner).post(`/clubs/${clubId}/events/${eventId}/direct-payments/${p.id}/confirm`).expect(204);
    expect(
      (await as(owner).post(`/clubs/${clubId}/events/${eventId}/direct-payments/${p.id}/confirm`).expect(409)).body.code,
    ).toBe('PAYMENT_NOT_PENDING');

    expect(await event(ada, eventId)).toMatchObject({
      youreGoing: true,
      yourPendingPayment: null,
      // paid to the organisers: refunds are theirs, not Muster's
      yourPayment: { amountCents: 50000, currency: 'npr', direct: true, refundable: false },
    });
    expect(await pending(eventId)).toEqual([]);
    expect((await event(owner, eventId)).salesCents).toBe(50000);
    await vi.waitFor(() =>
      expect(t.mail.sent.filter((e) => e.to === ada.email && e.subject === 'Your ticket: Robot Wars')).toHaveLength(1),
    );
    const log = (await as(owner).get(`/orgs/${orgId}/audit`).expect(200)).body.entries.map((e: { summary: string }) => e.summary);
    expect(log).toContain(`marked ${ada.name}’s payment for “Robot Wars” as received (NPR 500.00, reference ${reference})`);
  });

  it('giving the place back refunds nothing through Muster', async () => {
    await as(ada).delete(`/clubs/${clubId}/events/${eventId}/my-registration`).expect(204);
    expect(t.payments.refunds.size).toBe(0);
  });
});

describe('turning a payment down, and giving up', () => {
  let eventId = '';

  beforeAll(async () => {
    eventId = (await paidEvent('Soldering 101', { capacity: 1 })).id;
  });

  it('puts the place back on offer and tells them', async () => {
    const { reference } = (await buy(bo, eventId).expect(200)).body.payment;
    const [p] = await pending(eventId);
    await as(owner).post(`/clubs/${clubId}/events/${eventId}/direct-payments/${p.id}/decline`).expect(204);
    await as(owner).post(`/clubs/${clubId}/events/${eventId}/direct-payments/${p.id}/decline`).expect(409);
    expect(await event(bo, eventId)).toMatchObject({ youreGoing: false, yourPendingPayment: null, heldCount: 0 });
    await vi.waitFor(() => {
      const email = t.mail.sent.find((e) => e.to === bo.email && e.subject === "Your payment wasn't confirmed: Soldering 101");
      expect(email?.text).toContain(`reference ${reference}`);
    });
  });

  it('lets someone give up their hold before paying', async () => {
    await buy(cy, eventId).expect(200);
    await as(cy).delete(`/clubs/${clubId}/events/${eventId}/checkout`).expect(204);
    await as(cy).delete(`/clubs/${clubId}/events/${eventId}/checkout`).expect(404);
    expect((await event(cy, eventId)).heldCount).toBe(0);
    // and the place is free again
    await buy(bo, eventId).expect(200);
  });
});

describe('a hold that ran out', () => {
  it('frees the place, and can still be confirmed while there is room, but not once it has gone', async () => {
    const roomy = (await paidEvent('Late Payers', { capacity: 2 })).id;
    await buy(ada, roomy).expect(200);
    await db.query(`UPDATE checkouts SET expires_at = now() - interval '1 minute' WHERE event_id = $1`, [roomy]);
    expect((await event(ada, roomy)).yourPendingPayment).toBeNull();
    const [late] = await pending(roomy);
    expect(late.expired).toBe(true);
    await as(owner).post(`/clubs/${clubId}/events/${roomy}/direct-payments/${late.id}/confirm`).expect(204);
    expect((await event(ada, roomy)).youreGoing).toBe(true);

    const tight = (await paidEvent('Last Seat', { capacity: 1 })).id;
    await buy(ada, tight).expect(200);
    await db.query(`UPDATE checkouts SET expires_at = now() - interval '1 minute' WHERE event_id = $1`, [tight]);
    // the place went to Bo meanwhile
    await buy(bo, tight).expect(200);
    const [bos] = await pending(tight).then((list) => list.filter((p) => p.name === bo.name));
    await as(owner).post(`/clubs/${clubId}/events/${tight}/direct-payments/${bos.id}/confirm`).expect(204);
    const [adas] = await pending(tight);
    expect(
      (await as(owner).post(`/clubs/${clubId}/events/${tight}/direct-payments/${adas.id}/confirm`).expect(409)).body.code,
    ).toBe('EVENT_FULL');
  });
});

describe('a guest buying from the public page', () => {
  it('gets the hold and how to pay, without Stripe', async () => {
    const ev = await paidEvent('Open Build Night', { visibility: 'public' });
    const pub = (await t.api().get(`/public/events/${ev.id}`).expect(200)).body;
    expect(pub).toMatchObject({ payDirectly: true, price: { amountCents: 50000, currency: 'npr' } });

    const email = `gita-${t.suffix}@example.com`;
    await t.api().post(`/public/events/${ev.id}/places`).send({ name: 'Gita', email }).expect(202);
    const sent = t.mail.sent.filter((e) => e.to === email).at(-1)!;
    const token = sent.text.match(/\/e\/[0-9a-f-]+\/confirm\?token=([\w.-]+)/)![1];
    const res = await t.api().post(`/public/events/${ev.id}/places/confirm`).send({ token }).expect(200);
    expect(res.body.payment).toMatchObject({ amountCents: 50000, currency: 'npr', instructions: 'eSewa: 9800000000 (Robotics Club)' });
    await vi.waitFor(() =>
      expect(t.mail.sent.some((e) => e.to === email && e.subject === 'Pay for your ticket: Open Build Night')).toBe(true),
    );
    expect(await pending(ev.id)).toMatchObject([{ name: 'Gita', reference: res.body.payment.reference }]);
  });
});

describe('switching back to Stripe', () => {
  it('prices new events in the Stripe account’s currency again', async () => {
    await as(owner).post(`/orgs/${orgId}/payments/connect`).expect(200);
    await as(owner).post(`/orgs/${orgId}/payments/refresh`).expect(200);
    const res = await as(owner).patch(`/orgs/${orgId}/payments`, { method: 'stripe' }).expect(200);
    expect(res.body).toMatchObject({ method: 'stripe', ready: true, currency: 'aud' });
    // the direct details are kept for next time
    expect(res.body.direct.instructions).toBe('eSewa: 9800000000 (Robotics Club)');
    const ev = await paidEvent('Back On Stripe');
    expect((await buy(ada, ev.id).expect(200)).body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
  });
});
