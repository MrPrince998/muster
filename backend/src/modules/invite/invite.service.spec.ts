import { HttpError } from '../../common/errors/http-error.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import type { TenantService } from '../../database/tenant.service.js';
import { ClubAccess } from '../permission/club-access.js';
import { Permission } from '../permission/permissions.js';
import { InviteService } from './invite.service.js';
import type { OrgJoinRequestService } from '../organisation/join-requests/org-join-request.service.js';

const user: AuthUser = { id: 'u-new', sessionId: 's1' };

// An invite as byCode() reads it: active, no limits, no approval, no role.
function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv1',
    code: 'code1',
    club_id: 'club1',
    default_role_id: null,
    role_name: null,
    requires_approval: false,
    max_uses: null,
    use_count: 0,
    expires_at: null,
    revoked_at: null,
    created_by_name: null,
    created_at: new Date(),
    created_by: 'u-owner',
    org_id: 'org1',
    org_name: 'State University',
    org_slug: 'state-uni',
    club_name: 'Coding Club',
    club_is_default: false,
    ...overrides,
  };
}

/**
 * A fake database: each query is matched by a fragment of its SQL to a
 * canned answer; every statement run is recorded so tests can check what
 * was written. Unmatched queries answer [] (no rows).
 */
function setup(answers: [fragment: string, answer: unknown][] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const match = answers.find(([fragment]) => sql.includes(fragment));
      return match ? match[1] : [];
    }),
  };
  const tenant = {
    orgIdForClub: vi.fn().mockResolvedValue('org1'),
    orgIdForInviteCode: vi.fn().mockResolvedValue('org1'),
    withTenant: vi.fn((_orgId: string, work: (m: typeof manager) => unknown) => work(manager)),
  };
  const service = new InviteService(tenant as unknown as TenantService, {} as OrgJoinRequestService);
  const ran = (fragment: string) => calls.filter((call) => call.sql.includes(fragment));
  return { service, tenant, calls, ran };
}

const access = (permissions: Permission[], highestPosition = 30, isOwner = false) =>
  new ClubAccess('club1', 'u-me', isOwner, highestPosition, permissions);

async function expectHttpError(promise: Promise<unknown>, statusCode: number, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ statusCode, code });
}

describe('InviteService.create', () => {
  it('makes an unguessable, URL-safe code', async () => {
    const { service, ran } = setup([
      ['INSERT INTO invites', [{ id: 'inv1' }]],
      ['WHERE i.id = $1', [inviteRow()]],
    ]);
    await service.create(access([Permission.InviteManage]), { maxUses: 5, expiresInDays: 7 });

    const [code] = ran('INSERT INTO invites')[0].params.slice(2, 3) as string[];
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 random bytes, base64url
  });

  it('refuses a role that is not below your own', async () => {
    const { service, ran } = setup([['FROM roles WHERE id', [{ position: 40, is_owner: false }]]]);
    await expectHttpError(
      service.create(access([Permission.InviteManage], 30), { defaultRoleId: 'role-admin' }),
      403,
      'ROLE_TOO_HIGH',
    );
    expect(ran('INSERT INTO invites')).toHaveLength(0);
  });

  it('refuses a role from another club', async () => {
    const { service } = setup([['FROM roles WHERE id', []]]);
    await expectHttpError(service.create(access([Permission.InviteManage]), { defaultRoleId: 'elsewhere' }), 400, 'ROLE_NOT_FOUND');
  });

  it('never lets anyone hand out the Owner role', async () => {
    const { service } = setup([['FROM roles WHERE id', [{ position: 100, is_owner: true }]]]);
    await expectHttpError(
      service.create(access([Permission.InviteManage], 100, true), { defaultRoleId: 'owner-role' }),
      403,
      'ROLE_TOO_HIGH',
    );
  });
});

describe('InviteService.preview', () => {
  it.each([
    ['active', {}],
    ['revoked', { revoked_at: new Date() }],
    ['expired', { expires_at: new Date(Date.now() - 1000) }],
    ['used_up', { max_uses: 3, use_count: 3 }],
  ])('reports a %s link', async (status, overrides) => {
    const { service } = setup([['WHERE i.code = $1', [inviteRow(overrides)]]]);
    await expect(service.preview(user, 'code1')).resolves.toMatchObject({ status });
  });

  it('says when you are already in, or already waiting', async () => {
    const { service } = setup([
      ['WHERE i.code = $1', [inviteRow({ requires_approval: true })]],
      ['FROM club_members WHERE club_id', [{ '?column?': 1 }]],
      ["status = 'pending'", [{ '?column?': 1 }]],
    ]);
    await expect(service.preview(user, 'code1')).resolves.toMatchObject({
      alreadyMember: true,
      requiresApproval: true,
      pendingRequest: true,
    });
  });

  it('is a 404 for a code no workspace has', async () => {
    const { service, tenant } = setup();
    tenant.orgIdForInviteCode.mockResolvedValue(null);
    await expectHttpError(service.preview(user, 'nope'), 404, 'INVITE_NOT_FOUND');
  });
});

describe('InviteService.accept', () => {
  it('joins the workspace, its default club, the club and the role', async () => {
    const { service, ran } = setup([
      ['WHERE i.code = $1', [inviteRow({ default_role_id: 'role-scanner' })]],
      ['UPDATE invites SET use_count', [[{ id: 'inv1' }], 1]],
      ['INSERT INTO org_members', [{ user_id: user.id }]], // new to the workspace
    ]);

    await expect(service.accept(user, 'code1')).resolves.toEqual({
      workspaceSlug: 'state-uni',
      clubId: 'club1',
      status: 'joined',
    });
    expect(ran('UPDATE invites SET use_count')).toHaveLength(1);
    expect(ran('WHERE org_id = $1 AND is_default')).toHaveLength(1); // the default club
    expect(ran('VALUES ($1, $2, $3) ON CONFLICT DO NOTHING')[0].params).toEqual(['club1', user.id, 'org1']);
    expect(ran('INSERT INTO member_roles')[0].params).toEqual(['club1', user.id, 'role-scanner', 'org1', 'u-owner']);
  });

  it('does not re-add the default club for someone already in the workspace', async () => {
    const { service, ran } = setup([
      ['WHERE i.code = $1', [inviteRow()]],
      ['UPDATE invites SET use_count', [[{ id: 'inv1' }], 1]],
      ['INSERT INTO org_members', []], // conflict: already a member
    ]);
    await service.accept(user, 'code1');
    expect(ran('WHERE org_id = $1 AND is_default')).toHaveLength(0);
  });

  it('takes no use from someone already in the club', async () => {
    const { service, ran } = setup([
      ['WHERE i.code = $1', [inviteRow()]],
      ['FROM club_members WHERE club_id', [{ '?column?': 1 }]],
    ]);
    await expect(service.accept(user, 'code1')).resolves.toMatchObject({ status: 'already_member' });
    expect(ran('UPDATE invites')).toHaveLength(0);
  });

  it.each([
    ['INVITE_REVOKED', { revoked_at: new Date() }],
    ['INVITE_EXPIRED', { expires_at: new Date(Date.now() - 1000) }],
    ['INVITE_USED_UP', { max_uses: 1, use_count: 1 }],
    // read as active, but the atomic UPDATE found the last use gone: a lost race
    ['INVITE_USED_UP', {}],
  ])('refuses with %s when no use can be taken', async (code, overrides) => {
    const { service, ran } = setup([
      ['WHERE i.code = $1', [inviteRow(overrides)]],
      ['UPDATE invites SET use_count', [[], 0]],
    ]);
    await expectHttpError(service.accept(user, 'code1'), 410, code);
    expect(ran('INSERT INTO org_members')).toHaveLength(0);
  });

  it('files a request instead of joining when the link needs approval', async () => {
    const { service, ran } = setup([
      ['WHERE i.code = $1', [inviteRow({ requires_approval: true })]],
      ['UPDATE invites SET use_count', [[{ id: 'inv1' }], 1]],
    ]);
    await expect(service.accept(user, 'code1')).resolves.toMatchObject({ status: 'requested' });
    expect(ran('INSERT INTO join_requests')[0].params).toEqual(['org1', 'club1', 'inv1', user.id]);
    expect(ran('INSERT INTO org_members')).toHaveLength(0);
    expect(ran('INSERT INTO club_members')).toHaveLength(0);
  });

  it('takes no second use from someone already waiting', async () => {
    const { service, ran } = setup([
      ['WHERE i.code = $1', [inviteRow({ requires_approval: true })]],
      ["status = 'pending'", [{ '?column?': 1 }]],
    ]);
    await expect(service.accept(user, 'code1')).resolves.toMatchObject({ status: 'requested' });
    expect(ran('UPDATE invites')).toHaveLength(0);
    expect(ran('INSERT INTO join_requests')).toHaveLength(0);
  });
});

describe('InviteService approving and declining', () => {
  const approver = access([Permission.MemberApprove], 40);

  it('approving joins them with the role of their link, and records who decided', async () => {
    const { service, ran } = setup([
      ['FOR UPDATE OF jr', [{ user_id: 'u-asker', default_role_id: 'role-member' }]],
      ['INSERT INTO org_members', [{ user_id: 'u-asker' }]],
    ]);
    await service.approve(approver, 'req1');

    expect(ran('INSERT INTO member_roles')[0].params).toEqual(['club1', 'u-asker', 'role-member', 'org1', 'u-me']);
    expect(ran('UPDATE join_requests')[0].params).toEqual(['req1', 'approved', 'u-me']);
  });

  it('declining records the decision and joins nobody', async () => {
    const { service, ran } = setup([['FOR UPDATE OF jr', [{ user_id: 'u-asker', default_role_id: null }]]]);
    await service.reject(approver, 'req1');

    expect(ran('UPDATE join_requests')[0].params).toEqual(['req1', 'rejected', 'u-me']);
    expect(ran('INSERT INTO club_members')).toHaveLength(0);
  });

  it('a request someone else already decided is a 404', async () => {
    const { service, ran } = setup([['FOR UPDATE OF jr', []]]);
    await expectHttpError(service.approve(approver, 'req1'), 404, 'JOIN_REQUEST_NOT_FOUND');
    expect(ran('UPDATE join_requests')).toHaveLength(0);
  });
});
