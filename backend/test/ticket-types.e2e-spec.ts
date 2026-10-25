import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Ticket types and discount codes: an event's ways in (free or paid, for
 * members only, on sale until a date, limited in number), chosen however
 * someone takes a place; codes take money off, up to their limit, and one
 * that makes a ticket free skips Stripe.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;
let bo: TestUser;
let cy: TestUser;
let dee: TestUser;
let orgId = '';
let clubId = '';
let eventId = '';
const type: Record<string, string> = {};

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const as = (u: TestUser) => ({
  get: (path: string) => t.api().get(path).set('Authorization', u.auth),
  post: (path: string, body: object = {}) => t.api().post(path).set('Authorization', u.auth).send(body),
  patch: (path: string, body: object) => t.api().patch(path).set('Authorization', u.auth).send(body),
});
const getTicket = (u: TestUser, body: object) => as(u).post(`/clubs/${clubId}/events/${eventId}/checkout`, body);
const lastCheckout = () => t.payments.checkouts.at(-1)!;

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  [ada, bo, cy, dee] = [await t.user('Ada'), await t.user('Bo'), await t.user('Cy'), await t.user('Dee')];
  const org = await as(owner).post('/orgs', { name: `Tickets ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  orgId = org.body.id;
  for (const u of [ada, bo, cy, dee]) await as(u).post(`/orgs/by-slug/${org.body.slug}/join`).expect(201);
  clubId = (await as(owner).get(`/orgs/${orgId}/clubs`).expect(200)).body[0].id;
  await as(owner).post(`/orgs/${orgId}/payments/connect`).expect(200);
  await as(owner).post(`/orgs/${orgId}/payments/refresh`).expect(200);

  const event = await as(owner)
    .post(`/clubs/${clubId}/events`, {
      title: 'Robot Gala',
      startsAt: inDays(10),
      endsAt: inDays(10.2),
      visibility: 'public',
      publish: true,
      ticketTypes: [
        { name: 'Members', priceCents: 0, membersOnly: true },
        { name: 'General', priceCents: 2000 },
        { name: 'Early bird', priceCents: 1000, salesEndAt: inDays(-1) },
        { name: 'Student', priceCents: 1500, capacity: 1 },
      ],
    })
    .expect(201);
  eventId = event.body.id;
  for (const tt of event.body.ticketTypes as { id: string; name: string }[]) type[tt.name] = tt.id;
});
afterAll(() => t.close());

describe('ticket types', () => {
  it('lists them with what is on sale, and prices "from" the cheapest', async () => {
    const event = (await as(ada).get(`/clubs/${clubId}/events/${eventId}`).expect(200)).body;
    expect(event.ticketTypes.map((x: { name: string; onSale: boolean }) => [x.name, x.onSale])).toEqual([
      ['Members', true],
      ['General', true],
      ['Early bird', false],
      ['Student', true],
    ]);
    expect(event.price).toEqual({ amountCents: 1000, currency: 'aud' });
  });

  it('needs a choice when there is more than one, and a free one is yours at once', async () => {
    expect((await as(ada).post(`/clubs/${clubId}/events/${eventId}/my-registration`).expect(400)).body.code).toBe('TICKET_TYPE_REQUIRED');
    // a paid one can't be had for free
    await as(ada).post(`/clubs/${clubId}/events/${eventId}/my-registration`, { ticketTypeId: type.General }).expect(402);
    await as(ada).post(`/clubs/${clubId}/events/${eventId}/my-registration`, { ticketTypeId: type.Members }).expect(201);
    expect((await as(ada).get(`/clubs/${clubId}/events/${eventId}`).expect(200)).body.yourTicketType).toBe('Members');
  });

  it("won't sell a type past its end, or more of one than it has", async () => {
    expect((await getTicket(bo, { ticketTypeId: type['Early bird'] }).expect(409)).body.code).toBe('TICKET_SALES_ENDED');
    const student = await getTicket(bo, { ticketTypeId: type.Student }).expect(200);
    expect(student.body.registered).toBe(false);
    expect(lastCheckout()).toMatchObject({ amountCents: 1500, title: 'Robot Gala: Student' });
    // Bo's checkout holds the only student ticket
    expect((await getTicket(cy, { ticketTypeId: type.Student }).expect(409)).body.code).toBe('TICKET_TYPE_SOLD_OUT');
  });

  it("keeps members-only tickets off the public page, and from guests", async () => {
    const page = (await t.api().get(`/public/events/${eventId}`).expect(200)).body;
    expect(page.ticketTypes.map((x: { name: string }) => x.name)).toEqual(['General', 'Early bird', 'Student']);
    const refused = await t
      .api()
      .post(`/public/events/${eventId}/places`)
      .send({ name: 'Gwen', email: `gwen-${t.suffix}@example.com`, ticketTypeId: type.Members })
      .expect(400);
    expect(refused.body.code).toBe('TICKET_TYPE_NOT_FOUND');
  });

  it("won't remove a type someone has, and keeps ids through edits", async () => {
    const all = Object.entries(type).map(([name, id]) => ({ id, name, priceCents: name === 'Members' ? 0 : name === 'General' ? 2000 : name === 'Early bird' ? 1000 : 1500 }));
    const withoutMembers = all.filter((x) => x.name !== 'Members');
    expect((await as(owner).patch(`/clubs/${clubId}/events/${eventId}`, { ticketTypes: withoutMembers }).expect(409)).body.code).toBe(
      'TICKET_TYPE_HAS_SALES',
    );
    const edited = await as(owner)
      .patch(`/clubs/${clubId}/events/${eventId}`, {
        ticketTypes: [...all.map((x) => (x.name === 'General' ? { ...x, name: 'Standard' } : x)), { name: 'VIP', priceCents: 5000 }],
      })
      .expect(200);
    const after = Object.fromEntries(edited.body.ticketTypes.map((x: { name: string; id: string }) => [x.name, x.id]));
    expect(after.Standard).toBe(type.General);
    expect(after.VIP).toBeDefined();
    type.General = after.Standard;
  });
});

describe('discount codes', () => {
  it('are made by people who can edit the event', async () => {
    await as(ada).post(`/clubs/${clubId}/events/${eventId}/discount-codes`, { code: 'HACK', percentOff: 100 }).expect(403);
    await as(owner).post(`/clubs/${clubId}/events/${eventId}/discount-codes`, { code: 'half', percentOff: 50, maxUses: 1 }).expect(201);
    await as(owner).post(`/clubs/${clubId}/events/${eventId}/discount-codes`, { code: 'FIVEOFF', amountOffCents: 500 }).expect(201);
    await as(owner).post(`/clubs/${clubId}/events/${eventId}/discount-codes`, { code: 'FREEBIE', percentOff: 100 }).expect(201);
    expect((await as(owner).post(`/clubs/${clubId}/events/${eventId}/discount-codes`, { code: 'Half', percentOff: 10 }).expect(409)).body.code).toBe(
      'CODE_TAKEN',
    );
    await as(owner).post(`/clubs/${clubId}/events/${eventId}/discount-codes`, { code: 'BOTH', percentOff: 10, amountOffCents: 100 }).expect(400);
  });

  it('take money off, ignoring case, up to their limit', async () => {
    await getTicket(cy, { ticketTypeId: type.General, code: 'Half' }).expect(200);
    expect(lastCheckout()).toMatchObject({ amountCents: 1000 });
    // HALF's only use is Cy's open checkout
    expect((await getTicket(dee, { ticketTypeId: type.General, code: 'HALF' }).expect(400)).body.code).toBe('CODE_NOT_VALID');
    await getTicket(dee, { ticketTypeId: type.General, code: 'fiveoff' }).expect(200);
    expect(lastCheckout()).toMatchObject({ amountCents: 1500 });
    const codes = (await as(owner).get(`/clubs/${clubId}/events/${eventId}/discount-codes`).expect(200)).body;
    expect(codes.map((c: { code: string; uses: number }) => [c.code, c.uses])).toEqual([
      ['HALF', 1],
      ['FIVEOFF', 1],
      ['FREEBIE', 0],
    ]);
  });

  it('make a ticket free with no Stripe at all, and stop when turned off', async () => {
    const before = t.payments.checkouts.length;
    const free = await getTicket(owner, { ticketTypeId: type.General, code: 'FREEBIE' }).expect(200);
    expect(free.body).toEqual({ url: null, registered: true, payment: null });
    expect(t.payments.checkouts).toHaveLength(before);
    await vi.waitFor(() => expect(t.mail.sent.some((e) => e.to === owner.email && e.subject === 'Your ticket: Robot Gala')).toBe(true));

    const codes = (await as(owner).get(`/clubs/${clubId}/events/${eventId}/discount-codes`).expect(200)).body;
    const freebie = codes.find((c: { code: string }) => c.code === 'FREEBIE').id;
    await as(owner).patch(`/clubs/${clubId}/events/${eventId}/discount-codes/${freebie}`, { active: false }).expect(200);
    expect((await getTicket(bo, { ticketTypeId: type.General, code: 'FREEBIE' }).expect(400)).body.code).toBe('CODE_NOT_VALID');
  });

  it('work for guests too, through their emailed link', async () => {
    const email = `gwen-${t.suffix}@example.com`;
    expect((await t.api().get(`/public/events/${eventId}`).expect(200)).body.hasCodes).toBe(true);
    await t
      .api()
      .post(`/public/events/${eventId}/places`)
      .send({ name: 'Gwen', email, ticketTypeId: type.General, code: 'NOPE' })
      .expect(400);
    await t.api().post(`/public/events/${eventId}/places`).send({ name: 'Gwen', email, ticketTypeId: type.General, code: 'fiveoff' }).expect(202);
    const token = t.mail.sent.filter((e) => e.to === email).at(-1)!.text.match(/confirm\?token=([\w.-]+)/)![1];
    const confirmed = await t.api().post(`/public/events/${eventId}/places/confirm`).send({ token }).expect(200);
    expect(confirmed.body.checkoutUrl).toBeDefined();
    expect(lastCheckout()).toMatchObject({ amountCents: 1500, email, title: 'Robot Gala: Standard' });
  });

  it('show in the spreadsheet: which ticket, what was paid, which code', async () => {
    const csv = (await as(owner).get(`/clubs/${clubId}/events/${eventId}/registrations/export`).buffer(true).expect(200)).text;
    const [header, ...rows] = csv.replace('﻿', '').trim().split('\r\n');
    expect(header).toMatch(/^Name,Status,Registered \(.+\),Checked in \(.+\),From outside the workspace,Ticket,Paid,Code$/);
    expect(rows.find((r) => r.startsWith(ada.name))).toMatch(/,Members,,$/);
    expect(rows.find((r) => r.startsWith(owner.name))).toMatch(/,FREEBIE$/);
  });
});
