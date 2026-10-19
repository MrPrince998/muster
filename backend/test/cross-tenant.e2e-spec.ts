import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Tenant isolation through the API (README: "Testing → Tenant isolation").
 * tenant-isolation.e2e-spec.ts proves Postgres keeps workspaces apart; this
 * proves no route can be pointed at another workspace's ids, including by
 * mixing a club you run with an event from elsewhere. The attacker owns
 * workspace A outright, so every permission check passes on their own data:
 * only the tenant boundary stands in the way.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let attacker: TestUser;
let victim: TestUser;
let guest: TestUser;
const A = { orgId: '', clubId: '', eventId: '' };
const B = {
  orgId: '',
  slug: '',
  clubId: '',
  eventId: '',
  draftId: '',
  roleId: '',
  inviteId: '',
  ticketToken: '',
  registrationId: '',
};

const ok = (status: number) => status >= 200 && status < 300;

beforeAll(async () => {
  t = await createTestApp();
  attacker = await t.user('Mallory');
  victim = await t.user('Victoria');
  guest = await t.user('Gus');

  // A: everything the attacker could want, all theirs
  const a = await t.api().post('/orgs').set('Authorization', attacker.auth).send({ name: `Alpha ${t.suffix}` }).expect(201);
  A.orgId = a.body.id;
  A.clubId = (await t.api().get(`/orgs/${A.orgId}/clubs`).set('Authorization', attacker.auth).expect(200)).body[0].id;
  const hour = 3_600_000;
  const at = (h: number) => new Date(Date.now() + h * hour).toISOString();
  A.eventId = (
    await t
      .api()
      .post(`/clubs/${A.clubId}/events`)
      .set('Authorization', attacker.auth)
      .send({ title: 'Alpha Night', startsAt: at(24), endsAt: at(27), publish: true })
      .expect(201)
  ).body.id;

  // B: someone else's workspace, with a member holding a ticket
  const b = await t
    .api()
    .post('/orgs')
    .set('Authorization', victim.auth)
    .send({ name: `Bravo ${t.suffix}`, joinPolicy: 'open' })
    .expect(201);
  B.orgId = b.body.id;
  B.slug = b.body.slug;
  B.clubId = (await t.api().get(`/orgs/${B.orgId}/clubs`).set('Authorization', victim.auth).expect(200)).body[0].id;
  const event = (title: string, publish: boolean) =>
    t
      .api()
      .post(`/clubs/${B.clubId}/events`)
      .set('Authorization', victim.auth)
      .send({ title, startsAt: at(48), endsAt: at(51), publish })
      .expect(201);
  B.eventId = (await event('Bravo Secret Gala', true)).body.id;
  B.draftId = (await event('Bravo Secret Draft', false)).body.id;
  B.roleId = (await t.api().get(`/clubs/${B.clubId}/roles`).set('Authorization', victim.auth).expect(200)).body.at(-1).id;
  B.inviteId = (await t.api().post(`/clubs/${B.clubId}/invites`).set('Authorization', victim.auth).send({}).expect(201)).body.id;
  await t.api().post(`/orgs/by-slug/${B.slug}/join`).set('Authorization', guest.auth).expect(201);
  B.registrationId = (
    await t.api().post(`/clubs/${B.clubId}/events/${B.eventId}/my-registration`).set('Authorization', guest.auth).expect(201)
  ).body.id;
  B.ticketToken = (
    await t.api().get(`/clubs/${B.clubId}/events/${B.eventId}/my-ticket`).set('Authorization', guest.auth).expect(200)
  ).body.token;
});

afterAll(() => t.close());

describe('cross-tenant access through the API', () => {
  const routes = (): [method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: object][] => [
    // the workspace itself
    ['get', `/orgs/${B.orgId}`],
    ['patch', `/orgs/${B.orgId}`, { name: 'Hijacked' }],
    ['delete', `/orgs/${B.orgId}`, { confirmSlug: B.slug }],
    ['get', `/orgs/${B.orgId}/clubs`],
    ['post', `/orgs/${B.orgId}/clubs`, { name: 'Implant' }],
    ['get', `/orgs/${B.orgId}/members`],
    ['patch', `/orgs/${B.orgId}/members/${guest.id}`, { role: 'admin' }],
    ['delete', `/orgs/${B.orgId}/members/${guest.id}`],
    ['post', `/orgs/${B.orgId}/transfer-ownership`, { userId: attacker.id }],
    ['get', `/orgs/${B.orgId}/join-requests`],
    ['get', `/orgs/${B.orgId}/audit`],
    ['get', `/orgs/${B.orgId}/payments`],
    ['post', `/orgs/${B.orgId}/payments/connect`],
    ['post', `/orgs/${B.orgId}/payments/refresh`],
    ['post', `/orgs/${B.orgId}/payments/dashboard`],
    ['post', `/clubs/${B.clubId}/events/${B.eventId}/checkout`],
    ['post', `/clubs/${A.clubId}/events/${B.eventId}/checkout`],
    ['get', `/orgs/by-slug/${B.slug}`],
    // its club, events and the people in them
    ['get', `/clubs/${B.clubId}/events`],
    ['post', `/clubs/${B.clubId}/events`, { title: 'Implant', startsAt: new Date(Date.now() + 1e8).toISOString(), endsAt: new Date(Date.now() + 2e8).toISOString() }],
    ['get', `/clubs/${B.clubId}/events/${B.eventId}`],
    ['get', `/clubs/${B.clubId}/events/${B.draftId}`],
    ['patch', `/clubs/${B.clubId}/events/${B.eventId}`, { title: 'Hijacked' }],
    ['post', `/clubs/${B.clubId}/events/${B.draftId}/publish`],
    ['post', `/clubs/${B.clubId}/events/${B.eventId}/cancel`, {}],
    ['delete', `/clubs/${B.clubId}/events/${B.draftId}`],
    ['get', `/clubs/${B.clubId}/events/${B.eventId}/registrations`],
    ['get', `/clubs/${B.clubId}/events/${B.eventId}/registrations/export`],
    ['get', `/clubs/${B.clubId}/events/${B.eventId}/calendar`],
    ['get', `/clubs/${B.clubId}/events/${B.eventId}/messages`],
    ['post', `/clubs/${B.clubId}/events/${B.eventId}/messages`, { subject: 'Hijack', body: 'Hijack' }],
    ['post', `/clubs/${A.clubId}/events/${B.eventId}/messages`, { subject: 'Hijack', body: 'Hijack' }],
    ['post', `/clubs/${B.clubId}/events/${B.eventId}/my-registration`],
    ['get', `/clubs/${B.clubId}/events/${B.eventId}/my-ticket`],
    ['post', `/clubs/${B.clubId}/events/${B.eventId}/check-in`, { token: B.ticketToken }],
    ['post', `/clubs/${B.clubId}/events/${B.eventId}/check-in/manual`, { userId: guest.id }],
    ['get', `/clubs/${B.clubId}/events/${B.eventId}/check-in/roster`],
    ['post', `/clubs/${B.clubId}/events/${B.eventId}/check-in/sync`, { checkIns: [{ registrationId: B.registrationId, at: new Date().toISOString() }] }],
    ['post', `/clubs/${B.clubId}/events/${B.eventId}/waitlist`],
    ['delete', `/clubs/${B.clubId}/events/${B.eventId}/waitlist`],
    // its members, roles and invite links
    ['get', `/clubs/${B.clubId}/members`],
    ['put', `/clubs/${B.clubId}/members/${guest.id}/roles`, { roleIds: [B.roleId] }],
    ['delete', `/clubs/${B.clubId}/members/${guest.id}`],
    ['post', `/clubs/${B.clubId}/transfer-ownership`, { userId: attacker.id }],
    ['get', `/clubs/${B.clubId}/roles`],
    ['post', `/clubs/${B.clubId}/roles`, { name: 'Implant', permissions: [] }],
    ['patch', `/clubs/${B.clubId}/roles/${B.roleId}`, { name: 'Hijacked' }],
    ['post', `/clubs/${B.clubId}/roles/${B.roleId}/move`, { direction: 'up' }],
    ['delete', `/clubs/${B.clubId}/roles/${B.roleId}`],
    ['get', `/clubs/${B.clubId}/invites`],
    ['post', `/clubs/${B.clubId}/invites`, {}],
    ['delete', `/clubs/${B.clubId}/invites/${B.inviteId}`],
    ['get', `/clubs/${B.clubId}/join-requests`],
    ['get', `/clubs/${B.clubId}/analytics`],
    ['get', `/clubs/${B.clubId}/event-emails`],
    ['get', `/clubs/${B.clubId}/events/${B.eventId}/feedback`],
    ['get', `/clubs/${A.clubId}/events/${B.eventId}/feedback`],
    ['put', `/clubs/${B.clubId}/event-emails`, { eventEmails: 'instant' }],
    // a club the attacker runs, with an event (or role) from the other workspace
    ['get', `/clubs/${A.clubId}/events/${B.eventId}`],
    ['patch', `/clubs/${A.clubId}/events/${B.eventId}`, { title: 'Hijacked' }],
    ['post', `/clubs/${A.clubId}/events/${B.eventId}/cancel`, {}],
    ['delete', `/clubs/${A.clubId}/events/${B.draftId}`],
    ['post', `/clubs/${A.clubId}/events/${B.draftId}/publish`],
    ['get', `/clubs/${A.clubId}/events/${B.eventId}/registrations`],
    ['get', `/clubs/${A.clubId}/events/${B.eventId}/registrations/export`],
    ['get', `/clubs/${A.clubId}/events/${B.eventId}/calendar`],
    ['post', `/clubs/${A.clubId}/events/${B.eventId}/my-registration`],
    ['post', `/clubs/${A.clubId}/events/${B.eventId}/check-in`, { token: B.ticketToken }],
    ['post', `/clubs/${A.clubId}/events/${B.eventId}/check-in/manual`, { userId: guest.id }],
    ['get', `/clubs/${A.clubId}/events/${B.eventId}/check-in/roster`],
    ['post', `/clubs/${A.clubId}/events/${B.eventId}/check-in/sync`, { checkIns: [{ registrationId: B.registrationId, at: new Date().toISOString() }] }],
    ['post', `/clubs/${A.clubId}/events/${B.eventId}/waitlist`],
    ['delete', `/clubs/${A.clubId}/events/${B.eventId}/waitlist`],
    ['patch', `/clubs/${A.clubId}/roles/${B.roleId}`, { name: 'Hijacked' }],
    ['delete', `/clubs/${A.clubId}/roles/${B.roleId}`],
    ['put', `/clubs/${A.clubId}/members/${guest.id}/roles`, { roleIds: [] }],
  ];

  it("refuses every route aimed at another workspace's data, and changes nothing", async () => {
    const before = await snapshot();
    const leaks: string[] = [];
    for (const [method, path, body] of routes()) {
      const req = t.api()[method](path).set('Authorization', attacker.auth);
      const res = await (body ? req.send(body) : req);
      if (ok(res.status) || ![400, 403, 404].includes(res.status)) {
        leaks.push(`${method.toUpperCase()} ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      }
    }
    expect(leaks).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("a ticket from another workspace gets nobody into your event", async () => {
    const res = await t
      .api()
      .post(`/clubs/${A.clubId}/events/${A.eventId}/check-in`)
      .set('Authorization', attacker.auth)
      .send({ token: B.ticketToken })
      .expect(200);
    expect(res.body.outcome).toBe('wrong_event');
    expect(res.body.attendeeName).toBeUndefined();
    const ticket = await t
      .api()
      .get(`/clubs/${B.clubId}/events/${B.eventId}/my-ticket`)
      .set('Authorization', guest.auth)
      .expect(200);
    expect(ticket.body.checkedInAt).toBeNull();
  });

  it("search, tickets and workspace lists show nothing from the other workspace", async () => {
    const found = await t.api().get('/search').query({ q: 'Bravo Secret' }).set('Authorization', attacker.auth).expect(200);
    expect(found.body).toEqual({ workspaces: [], clubs: [], events: [], people: [] });
    const people = await t.api().get('/search').query({ q: 'Victoria' }).set('Authorization', attacker.auth).expect(200);
    expect(people.body.people).toEqual([]);

    const tickets = await t.api().get('/me/tickets').set('Authorization', attacker.auth).expect(200);
    expect(tickets.body.map((x: { eventId: string }) => x.eventId)).not.toContain(B.eventId);

    const orgs = await t.api().get('/orgs').set('Authorization', attacker.auth).expect(200);
    expect(orgs.body.map((o: { orgId: string }) => o.orgId)).toEqual([A.orgId]);
  });

  it("the other user's own account is out of reach too", async () => {
    await t.api().get(`/user/${victim.id}`).set('Authorization', attacker.auth).expect(404);
    await t.api().patch(`/user/${victim.id}`).set('Authorization', attacker.auth).send({ name: 'Hijacked' }).expect(404);
    await t.api().delete(`/user/${victim.id}`).set('Authorization', attacker.auth).send({ password: 'x' }).expect(404);
  });
});

// what workspace B looks like to its owner: anything the attacker managed to change shows up here
async function snapshot() {
  const get = async (path: string, as = victim) => (await t.api().get(path).set('Authorization', as.auth).expect(200)).body;
  const [org, members, clubs, events, drafts, roles, clubMembers, invites, ticket] = await Promise.all([
    get(`/orgs/${B.orgId}`),
    get(`/orgs/${B.orgId}/members`),
    get(`/orgs/${B.orgId}/clubs`),
    get(`/clubs/${B.clubId}/events`),
    get(`/clubs/${B.clubId}/events?scope=drafts`),
    get(`/clubs/${B.clubId}/roles`),
    get(`/clubs/${B.clubId}/members`),
    get(`/clubs/${B.clubId}/invites`),
    get(`/clubs/${B.clubId}/events/${B.eventId}/my-ticket`, guest),
  ]);
  // the ticket is signed afresh on every read: compare what it says, not its signature
  const { token: _token, qrSvg: _qr, ...ticketDetails } = ticket;
  return { org, members, clubs, events, drafts, roles, clubMembers, invites, ticket: ticketDetails };
}
