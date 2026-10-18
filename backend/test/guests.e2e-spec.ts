import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Public events and guests (README: "Joining"): anyone with the link sees a
 * public event and asks for a place with a name and an email; the place is
 * taken only when they confirm from that inbox, and the ticket's own token
 * is how a guest (who can't sign in) gets back to it.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let organiser: TestUser;
let clubId = '';
const ev = { open: '', membersOnly: '', draft: '', tiny: '' };

const hour = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * hour).toISOString();
const guestEmail = (name: string) => `${name}-${t.suffix}@example.com`;

// the link in the newest email to `to` containing `path`
function linkIn(to: string, pattern: RegExp): string {
  const email = t.mail.sent.filter((e) => e.to === to && pattern.test(e.text)).at(-1);
  const match = email?.text.match(pattern);
  if (!match) throw new Error(`no email to ${to} matching ${pattern}`);
  return match[1];
}
const confirmToken = (to: string) => linkIn(to, /\/e\/[0-9a-f-]+\/confirm\?token=([\w.-]+)/);

function ask(eventId: string, name: string) {
  return t.api().post(`/public/events/${eventId}/places`).send({ name, email: guestEmail(name.toLowerCase()) });
}
function confirm(eventId: string, token: string) {
  return t.api().post(`/public/events/${eventId}/places/confirm`).send({ token });
}
const placesLeft = async (eventId: string) =>
  (await t.api().get(`/public/events/${eventId}`).expect(200)).body.placesLeft as number | null;

beforeAll(async () => {
  t = await createTestApp();
  organiser = await t.user('Olive');
  const org = await t.api().post('/orgs').set('Authorization', organiser.auth).send({ name: `Guests ${t.suffix}` }).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', organiser.auth).expect(200)).body[0].id;
  const make = async (title: string, extra: object) =>
    (
      await t
        .api()
        .post(`/clubs/${clubId}/events`)
        .set('Authorization', organiser.auth)
        .send({ title, startsAt: at(24), endsAt: at(27), ...extra })
        .expect(201)
    ).body.id as string;
  ev.open = await make('Open Day', { visibility: 'public', capacity: 3, publish: true });
  ev.membersOnly = await make('Members Night', { publish: true });
  ev.draft = await make('Secret Plans', { visibility: 'public' });
  ev.tiny = await make('Tiny Talk', { visibility: 'public', capacity: 1, publish: true });
});

afterAll(async () => {
  // guests are users too: remove the ones these tests created
  await t.close();
});

describe('a public event page', () => {
  it('shows a public event to anyone, without signing in', async () => {
    const res = await t.api().get(`/public/events/${ev.open}`).expect(200);
    expect(res.body).toMatchObject({ title: 'Open Day', status: 'published', placesLeft: 3, registrationOpen: true });
    expect(res.body.clubName).toBe('General');
  });

  it('never shows a members-only event or a draft', async () => {
    await t.api().get(`/public/events/${ev.membersOnly}`).expect(404);
    await t.api().get(`/public/events/${ev.draft}`).expect(404);
    await t.api().post(`/public/events/${ev.membersOnly}/places`).send({ name: 'Eve', email: guestEmail('eve') }).expect(404);
  });
});

describe('asking for a place', () => {
  it('emails a confirmation link and holds nothing until it is used', async () => {
    await ask(ev.open, 'Gwen').then((r) => expect(r.status).toBe(202));
    expect(confirmToken(guestEmail('gwen'))).toBeTruthy();
    expect(await placesLeft(ev.open)).toBe(3);
  });

  it('confirming takes the place, emails the ticket, and is safe to repeat', async () => {
    const token = confirmToken(guestEmail('gwen'));
    const first = await confirm(ev.open, token).expect(200);
    expect(await placesLeft(ev.open)).toBe(2);
    await vi.waitFor(() =>
      expect(t.mail.sent.some((e) => e.to === guestEmail('gwen') && e.subject.startsWith('Your ticket'))).toBe(true),
    );

    const ticketEmail = t.mail.sent.filter((e) => e.to === guestEmail('gwen') && e.subject.startsWith('Your ticket'));
    expect(ticketEmail).toHaveLength(1);
    expect(ticketEmail[0].text).toContain(`/t/${first.body.ticketToken}`);
    expect(ticketEmail[0].attachments?.[0].filename).toBe('ticket.png');

    // the link clicked again: the same place, no second ticket email
    const again = await confirm(ev.open, token).expect(200);
    expect(await placesLeft(ev.open)).toBe(2);
    const ticketPage = await t.api().get(`/public/tickets/${again.body.ticketToken}`).expect(200);
    expect(ticketPage.body.registrationId).toBe(
      (await t.api().get(`/public/tickets/${first.body.ticketToken}`).expect(200)).body.registrationId,
    );
    expect(t.mail.sent.filter((e) => e.to === guestEmail('gwen') && e.subject.startsWith('Your ticket'))).toHaveLength(1);
  });

  it("refuses a link for another event, a forged one, and a ticket used as one", async () => {
    const token = confirmToken(guestEmail('gwen'));
    expect((await confirm(ev.tiny, token)).body.code).toBe('INVALID_TOKEN');
    expect((await confirm(ev.open, `${token.slice(0, -4)}AAAA`)).body.code).toBe('INVALID_TOKEN');
    const ticketToken = (await confirm(ev.open, token)).body.ticketToken;
    expect((await confirm(ev.open, ticketToken)).body.code).toBe('INVALID_TOKEN');
  });

  it("a guest can't sign in: they have no password", async () => {
    await t
      .api()
      .post('/auth/signin')
      .send({ email: guestEmail('gwen'), password: 'anything at all' })
      .expect(401);
  });

  it('a full event says so before any email goes out', async () => {
    await ask(ev.tiny, 'Hal').then((r) => expect(r.status).toBe(202));
    await confirm(ev.tiny, confirmToken(guestEmail('hal'))).expect(200);
    // the ticket email goes out in the background: let it land before counting
    await vi.waitFor(() => expect(t.mail.sent.some((e) => e.to === guestEmail('hal') && e.subject.startsWith('Your ticket'))).toBe(true));
    const sentBefore = t.mail.sent.length;
    expect((await ask(ev.tiny, 'Ivy')).body.code).toBe('EVENT_FULL');
    expect(t.mail.sent.length).toBe(sentBefore);
  });

  it('only one of two guests racing for the last place gets it', async () => {
    const tiny2 = (
      await t
        .api()
        .post(`/clubs/${clubId}/events`)
        .set('Authorization', organiser.auth)
        .send({ title: 'Last Seat', startsAt: at(30), endsAt: at(31), visibility: 'public', capacity: 1, publish: true })
        .expect(201)
    ).body.id;
    await ask(tiny2, 'Jo');
    await ask(tiny2, 'Kim');
    const results = await Promise.all([
      confirm(tiny2, confirmToken(guestEmail('jo'))),
      confirm(tiny2, confirmToken(guestEmail('kim'))),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await placesLeft(tiny2)).toBe(0);
  });
});

describe("a guest's ticket", () => {
  let token = '';
  beforeAll(async () => {
    await ask(ev.open, 'Lou');
    token = (await confirm(ev.open, confirmToken(guestEmail('lou'))).expect(200)).body.ticketToken;
  });

  it('opens by its own token, with the QR code', async () => {
    const res = await t.api().get(`/public/tickets/${token}`).expect(200);
    expect(res.body).toMatchObject({ eventTitle: 'Open Day', attendeeName: 'Lou', checkedInAt: null });
    expect(res.body.qrSvg).toContain('<svg');
  });

  it('gets them in at the door like any ticket, once', async () => {
    const scan = () =>
      t.api().post(`/clubs/${clubId}/events/${ev.open}/check-in`).set('Authorization', organiser.auth).send({ token });
    expect((await scan().expect(200)).body.outcome).toBe('checked_in');
    expect((await scan().expect(200)).body.outcome).toBe('already_checked_in');
    // and then the place can't be given back
    expect((await t.api().post(`/public/tickets/${token}/cancel`)).body.code).toBe('ALREADY_CHECKED_IN');
  });

  it('can be given back before the door, freeing the place', async () => {
    await ask(ev.open, 'Max');
    const maxToken = (await confirm(ev.open, confirmToken(guestEmail('max'))).expect(200)).body.ticketToken;
    const before = await placesLeft(ev.open);
    await t.api().post(`/public/tickets/${maxToken}/cancel`).expect(204);
    expect(await placesLeft(ev.open)).toBe((before ?? 0) + 1);
    await t.api().get(`/public/tickets/${maxToken}`).expect(404);
  });

  it('a made-up token opens nothing', async () => {
    await t.api().get('/public/tickets/not-a-ticket').expect(404);
    await t.api().post('/public/tickets/not-a-ticket/cancel').expect(404);
  });

  it('signing up later with the same email claims the account, ticket included', async () => {
    const email = guestEmail('lou');
    await t.api().post('/auth/signup').send({ email, name: 'Lou', password: 'correct horse battery staple' }).expect(201);
    await t.api().post('/auth/verify-email').send({ token: t.mail.tokenFor(email, '/verify-email') }).expect(204);
    const signin = await t
      .api()
      .post('/auth/signin')
      .send({ email, password: 'correct horse battery staple' })
      .expect(200);
    const mine = await t.api().get('/me/tickets').set('Authorization', `Bearer ${signin.body.accessToken}`).expect(200);
    expect(mine.body.map((x: { eventTitle: string }) => x.eventTitle)).toContain('Open Day');
  });
});
