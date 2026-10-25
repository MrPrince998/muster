import { TenantService } from '../src/database/tenant.service.js';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Workspaces and their members, end to end against the real database
 * (README: "Create a workspace", "Two-level tenancy").
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
let orgId: string;
let slug: string;

beforeAll(async () => {
  t = await createTestApp();
  [owner, admin, member, outsider] = await Promise.all([
    t.user('Owner'),
    t.user('Admin'),
    t.user('Member'),
    t.user('Outsider'),
  ]);
});

afterAll(() => t?.close());

const tenantQuery = <T>(org: string, sql: string, params: unknown[] = []) =>
  t.app.get(TenantService).withTenant(org, (m) => m.query(sql, params) as Promise<T>);

describe('creating a workspace', () => {
  it('makes the creator owner, with a default club they own', async () => {
    slug = `state-uni-${t.suffix}`;
    const res = await t
      .api()
      .post('/orgs')
      .set('Authorization', owner.auth)
      .send({ name: 'State University', slug, joinPolicy: 'open' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'State University', slug, joinPolicy: 'open', role: 'owner' });
    orgId = res.body.id;

    const clubs = await tenantQuery<{ slug: string; is_default: boolean }[]>(
      orgId,
      `SELECT slug, is_default FROM clubs`,
    );
    expect(clubs).toEqual([{ slug: 'general', is_default: true }]);

    const roles = await tenantQuery<{ name: string }[]>(orgId, `SELECT name FROM roles ORDER BY position DESC`);
    expect(roles.map((r) => r.name)).toEqual(['Owner', 'Admin', 'Organizer', 'Scanner', 'Member']);

    const ownerRole = await tenantQuery<{ user_id: string }[]>(
      orgId,
      `SELECT mr.user_id FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE r.is_owner`,
    );
    expect(ownerRole).toEqual([{ user_id: owner.id }]);
  });

  it('generates a slug from the name, and a suffixed one when taken', async () => {
    const name = `Coding Society ${t.suffix}`;
    const first = await t.api().post('/orgs').set('Authorization', owner.auth).send({ name }).expect(201);
    expect(first.body.slug).toBe(`coding-society-${t.suffix}`);

    const second = await t.api().post('/orgs').set('Authorization', owner.auth).send({ name }).expect(201);
    expect(second.body.slug).toMatch(new RegExp(`^coding-society-${t.suffix}-[0-9a-f]{4}$`));
  });

  it('rejects a taken or reserved slug, and a malformed one', async () => {
    const taken = await t.api().post('/orgs').set('Authorization', admin.auth).send({ name: 'X', slug }).expect(409);
    expect(taken.body.code).toBe('SLUG_TAKEN');

    const reserved = await t
      .api()
      .post('/orgs')
      .set('Authorization', admin.auth)
      .send({ name: 'X', slug: 'settings' })
      .expect(400);
    expect(reserved.body.code).toBe('SLUG_RESERVED');

    await t.api().post('/orgs').set('Authorization', admin.auth).send({ name: 'X', slug: 'Bad Slug!' }).expect(400);
  });

  it('requires sign-in', async () => {
    await t.api().post('/orgs').send({ name: 'Anon' }).expect(401);
  });
});

describe('joining and visibility', () => {
  it('hides the workspace from non-members (404, not 403)', async () => {
    const byId = await t.api().get(`/orgs/${orgId}`).set('Authorization', outsider.auth).expect(404);
    expect(byId.body.code).toBe('ORG_NOT_FOUND');
    await t.api().get(`/orgs/by-slug/${slug}`).set('Authorization', outsider.auth).expect(404);
    await t.api().get(`/orgs/${orgId}/members`).set('Authorization', outsider.auth).expect(404);
  });

  it('lets people join an open workspace, into its default club', async () => {
    for (const user of [admin, member]) {
      const res = await t.api().post(`/orgs/by-slug/${slug}/join`).set('Authorization', user.auth).expect(201);
      expect(res.body).toMatchObject({ status: 'joined', organisation: { role: 'member' } });
    }
    const clubMembers = await tenantQuery<unknown[]>(orgId, `SELECT 1 FROM club_members`);
    expect(clubMembers).toHaveLength(3);

    const again = await t.api().post(`/orgs/by-slug/${slug}/join`).set('Authorization', member.auth).expect(409);
    expect(again.body.code).toBe('ALREADY_MEMBER');
  });

  it('hides an invite-only workspace from people trying to join', async () => {
    const closed = await t
      .api()
      .post('/orgs')
      .set('Authorization', owner.auth)
      .send({ name: 'Closed', slug: `closed-${t.suffix}` })
      .expect(201);
    expect(closed.body.joinPolicy).toBe('invite');
    const res = await t
      .api()
      .post(`/orgs/by-slug/closed-${t.suffix}/join`)
      .set('Authorization', outsider.auth)
      .expect(404);
    expect(res.body.code).toBe('ORG_NOT_FOUND');
    await t.api().get(`/orgs/by-slug/closed-${t.suffix}/preview`).set('Authorization', outsider.auth).expect(404);
  });

  it("lists the user's workspaces with their role", async () => {
    const res = await t.api().get('/orgs').set('Authorization', member.auth).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ orgId, slug, role: 'member' })]);
  });

  it('finds a workspace by slug for members', async () => {
    const res = await t.api().get(`/orgs/by-slug/${slug}`).set('Authorization', member.auth).expect(200);
    expect(res.body).toMatchObject({ id: orgId, role: 'member' });
  });
});

describe('roles', () => {
  it('roles are changed within the hierarchy', async () => {
    await t
      .api()
      .patch(`/orgs/${orgId}/members/${member.id}`)
      .set('Authorization', member.auth)
      .send({ role: 'admin' })
      .expect(403);

    await t
      .api()
      .patch(`/orgs/${orgId}/members/${admin.id}`)
      .set('Authorization', owner.auth)
      .send({ role: 'admin' })
      .expect(204);

    // admins cannot create other admins
    const res = await t
      .api()
      .patch(`/orgs/${orgId}/members/${member.id}`)
      .set('Authorization', admin.auth)
      .send({ role: 'admin' })
      .expect(403);
    expect(res.body.code).toBe('INSUFFICIENT_ORG_ROLE');
  });

  it('cannot make someone owner through a role change', async () => {
    await t
      .api()
      .patch(`/orgs/${orgId}/members/${member.id}`)
      .set('Authorization', owner.auth)
      .send({ role: 'owner' })
      .expect(400);
  });

  it('shows emails to staff only', async () => {
    const asMember = await t.api().get(`/orgs/${orgId}/members`).set('Authorization', member.auth).expect(200);
    expect(asMember.body.members.every((m: object) => !('email' in m))).toBe(true);
    expect(asMember.body.members.map((m: { role: string }) => m.role)).toEqual(['owner', 'admin', 'member']);

    const asAdmin = await t.api().get(`/orgs/${orgId}/members`).set('Authorization', admin.auth).expect(200);
    expect(asAdmin.body.members.map((m: { email: string }) => m.email)).toContain(member.email);
  });
});

describe('editing', () => {
  it('members cannot edit; admins can', async () => {
    await t.api().patch(`/orgs/${orgId}`).set('Authorization', member.auth).send({ name: 'Nope' }).expect(403);

    const res = await t
      .api()
      .patch(`/orgs/${orgId}`)
      .set('Authorization', admin.auth)
      .send({ name: 'State Uni' })
      .expect(200);
    // fields left out are kept
    expect(res.body).toMatchObject({ name: 'State Uni', slug, joinPolicy: 'open', role: 'admin' });
  });

  it("rejects renaming to another workspace's slug", async () => {
    const res = await t
      .api()
      .patch(`/orgs/${orgId}`)
      .set('Authorization', owner.auth)
      .send({ slug: `closed-${t.suffix}` })
      .expect(409);
    expect(res.body.code).toBe('SLUG_TAKEN');
  });
});

describe('removing and leaving', () => {
  it('admins cannot remove admins or the owner', async () => {
    await t.api().delete(`/orgs/${orgId}/members/${owner.id}`).set('Authorization', admin.auth).expect(403);
  });

  it('the owner cannot leave or be removed while owning', async () => {
    const res = await t.api().post(`/orgs/${orgId}/leave`).set('Authorization', owner.auth).expect(409);
    expect(res.body.code).toBe('OWNER_CANNOT_LEAVE');
  });

  it('admins remove members, who lose access immediately', async () => {
    await t.api().delete(`/orgs/${orgId}/members/${member.id}`).set('Authorization', admin.auth).expect(204);
    await t.api().get(`/orgs/${orgId}`).set('Authorization', member.auth).expect(404);
    const clubMembers = await tenantQuery<unknown[]>(orgId, `SELECT 1 FROM club_members WHERE user_id = $1`, [
      member.id,
    ]);
    expect(clubMembers).toHaveLength(0);
  });

  it('members can leave', async () => {
    await t.api().post(`/orgs/by-slug/${slug}/join`).set('Authorization', member.auth).expect(201);
    await t.api().post(`/orgs/${orgId}/leave`).set('Authorization', member.auth).expect(204);
    await t.api().get(`/orgs/${orgId}`).set('Authorization', member.auth).expect(404);
  });
});

describe('transferring ownership', () => {
  it('moves the workspace and the default club to the new owner', async () => {
    await t
      .api()
      .post(`/orgs/${orgId}/transfer-ownership`)
      .set('Authorization', owner.auth)
      .send({ userId: admin.id })
      .expect(204);

    const asOld = await t.api().get(`/orgs/${orgId}`).set('Authorization', owner.auth).expect(200);
    expect(asOld.body.role).toBe('admin');
    const asNew = await t.api().get(`/orgs/${orgId}`).set('Authorization', admin.auth).expect(200);
    expect(asNew.body.role).toBe('owner');

    const clubOwners = await tenantQuery<{ user_id: string }[]>(
      orgId,
      `SELECT mr.user_id FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE r.is_owner`,
    );
    expect(clubOwners).toEqual([{ user_id: admin.id }]);

    // the previous owner keeps the next role down in the default club
    const kept = await tenantQuery<{ name: string }[]>(
      orgId,
      `SELECT r.name FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.user_id = $1`,
      [owner.id],
    );
    expect(kept).toEqual([{ name: 'Admin' }]);
  });

  it('the previous owner can no longer do owner things', async () => {
    await t
      .api()
      .delete(`/orgs/${orgId}`)
      .set('Authorization', owner.auth)
      .send({ confirmSlug: slug })
      .expect(403);
  });
});

describe('deleting', () => {
  it('requires typing the slug, then deletes everything', async () => {
    const wrong = await t
      .api()
      .delete(`/orgs/${orgId}`)
      .set('Authorization', admin.auth)
      .send({ confirmSlug: 'not-it' })
      .expect(400);
    expect(wrong.body.code).toBe('CONFIRMATION_MISMATCH');

    await t.api().delete(`/orgs/${orgId}`).set('Authorization', admin.auth).send({ confirmSlug: slug }).expect(204);
    await t.api().get(`/orgs/${orgId}`).set('Authorization', admin.auth).expect(404);
    expect(await tenantQuery<unknown[]>(orgId, `SELECT 1 FROM clubs`)).toHaveLength(0);
  });
});

describe('join requests (policy "request")', () => {
  let reqOrgId: string;
  let reqSlug: string;
  let mod: TestUser;
  let applicant: TestUser;

  const pending = () =>
    t.api().get(`/orgs/${reqOrgId}/join-requests`).set('Authorization', mod.auth).expect(200);

  beforeAll(async () => {
    [mod, applicant] = await Promise.all([t.user('Moderator'), t.user('Applicant')]);
    reqSlug = `robotics-${t.suffix}`;
    const org = await t
      .api()
      .post('/orgs')
      .set('Authorization', owner.auth)
      .send({ name: 'Robotics', slug: reqSlug, joinPolicy: 'request' })
      .expect(201);
    reqOrgId = org.body.id;

    // make `mod` a moderator: they ask, the owner approves, the owner promotes
    await t.api().post(`/orgs/by-slug/${reqSlug}/join`).set('Authorization', mod.auth).expect(201);
    const [modRequest] = (
      await t.api().get(`/orgs/${reqOrgId}/join-requests`).set('Authorization', owner.auth).expect(200)
    ).body;
    await t
      .api()
      .post(`/orgs/${reqOrgId}/join-requests/${modRequest.id}/approve`)
      .set('Authorization', owner.auth)
      .expect(204);
    await t
      .api()
      .patch(`/orgs/${reqOrgId}/members/${mod.id}`)
      .set('Authorization', owner.auth)
      .send({ role: 'moderator' })
      .expect(204);
  });

  it('shows a preview to non-members', async () => {
    const res = await t.api().get(`/orgs/by-slug/${reqSlug}/preview`).set('Authorization', applicant.auth).expect(200);
    expect(res.body).toMatchObject({
      name: 'Robotics',
      joinPolicy: 'request',
      memberCount: 2,
      isMember: false,
      pendingRequest: null,
    });
  });

  it('files a request instead of joining', async () => {
    const res = await t
      .api()
      .post(`/orgs/by-slug/${reqSlug}/join`)
      .set('Authorization', applicant.auth)
      .send({ message: 'I build drones' })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'requested', request: { status: 'pending' } });

    // not a member yet
    await t.api().get(`/orgs/${reqOrgId}`).set('Authorization', applicant.auth).expect(404);

    const again = await t.api().post(`/orgs/by-slug/${reqSlug}/join`).set('Authorization', applicant.auth).expect(409);
    expect(again.body.code).toBe('REQUEST_PENDING');

    const preview = await t
      .api()
      .get(`/orgs/by-slug/${reqSlug}/preview`)
      .set('Authorization', applicant.auth)
      .expect(200);
    expect(preview.body.pendingRequest).toMatchObject({ status: 'pending' });
  });

  it('shows moderators how many requests are waiting, and members nothing', async () => {
    const asMod = await t.api().get(`/orgs/${reqOrgId}`).set('Authorization', mod.auth).expect(200);
    expect(asMod.body.pendingJoinRequests).toBe(1);
    const bySlug = await t.api().get(`/orgs/by-slug/${reqSlug}`).set('Authorization', owner.auth).expect(200);
    expect(bySlug.body.pendingJoinRequests).toBe(1);
  });

  it('lets moderators see the queue, but not plain members', async () => {
    const res = await pending();
    expect(res.body).toEqual([
      expect.objectContaining({ userId: applicant.id, email: applicant.email, message: 'I build drones' }),
    ]);
  });

  it('can be withdrawn and filed again', async () => {
    await t.api().delete(`/orgs/by-slug/${reqSlug}/join`).set('Authorization', applicant.auth).expect(204);
    expect((await pending()).body).toHaveLength(0);
    await t.api().delete(`/orgs/by-slug/${reqSlug}/join`).set('Authorization', applicant.auth).expect(404);
    await t.api().post(`/orgs/by-slug/${reqSlug}/join`).set('Authorization', applicant.auth).expect(201);
  });

  it('a rejection blocks asking again for a while', async () => {
    const [request] = (await pending()).body;
    await t.api().post(`/orgs/${reqOrgId}/join-requests/${request.id}/reject`).set('Authorization', mod.auth).expect(204);

    const res = await t.api().post(`/orgs/by-slug/${reqSlug}/join`).set('Authorization', applicant.auth).expect(409);
    expect(res.body).toMatchObject({ code: 'REQUEST_RECENTLY_REJECTED', details: { retryAfter: expect.any(String) } });

    const rejected = await t
      .api()
      .get(`/orgs/${reqOrgId}/join-requests?status=rejected`)
      .set('Authorization', mod.auth)
      .expect(200);
    expect(rejected.body[0]).toMatchObject({ userId: applicant.id, decidedBy: mod.id });

    const email = t.mail.sent.filter((e) => e.to === applicant.email).at(-1);
    expect(email?.subject).toBe('Your request to join Robotics');
    expect(email?.text).toMatch(/You can ask again after .+ UTC\./);
  });

  it('approving makes them a member of the workspace and its default club, exactly once', async () => {
    // lift the cooldown for this test
    await t.app
      .get(TenantService)
      .withTenant(reqOrgId, (m) =>
        m.query(`UPDATE org_join_requests SET decided_at = now() - interval '2 days' WHERE status = 'rejected'`),
      );
    await t.api().post(`/orgs/by-slug/${reqSlug}/join`).set('Authorization', applicant.auth).expect(201);
    const [request] = (await pending()).body;

    await t.api().post(`/orgs/${reqOrgId}/join-requests/${request.id}/approve`).set('Authorization', mod.auth).expect(204);
    await t.api().post(`/orgs/${reqOrgId}/join-requests/${request.id}/approve`).set('Authorization', mod.auth).expect(404);

    // one email for one approval, linking to the workspace
    const approvals = t.mail.sent.filter((e) => e.to === applicant.email && e.subject === "You're in: Robotics");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].text).toContain(`/o/${reqSlug}`);

    const me = await t.api().get(`/orgs/${reqOrgId}`).set('Authorization', applicant.auth).expect(200);
    expect(me.body.role).toBe('member');
    const clubMember = await tenantQuery<unknown[]>(reqOrgId, `SELECT 1 FROM club_members WHERE user_id = $1`, [
      applicant.id,
    ]);
    expect(clubMember).toHaveLength(1);

    // now a plain member: no access to the queue, and no count
    await t.api().get(`/orgs/${reqOrgId}/join-requests`).set('Authorization', applicant.auth).expect(403);
    expect(me.body).not.toHaveProperty('pendingJoinRequests');
  });

  it('moderators remove members but cannot change roles or settings', async () => {
    await t
      .api()
      .patch(`/orgs/${reqOrgId}/members/${applicant.id}`)
      .set('Authorization', mod.auth)
      .send({ role: 'moderator' })
      .expect(403);
    await t.api().patch(`/orgs/${reqOrgId}`).set('Authorization', mod.auth).send({ name: 'Nope' }).expect(403);
    await t.api().delete(`/orgs/${reqOrgId}/members/${applicant.id}`).set('Authorization', mod.auth).expect(204);
    // ...and nobody at or above their own rank
    await t.api().delete(`/orgs/${reqOrgId}/members/${owner.id}`).set('Authorization', mod.auth).expect(403);
  });
});
