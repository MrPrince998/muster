import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpError } from '../../../common/errors/http-error.js';
import { ClubAccess } from '../club-access.js';
import type { PermissionService } from '../permission.service.js';
import { Permission } from '../permissions.js';
import { PermissionGuard } from './permission.guard.js';

const CLUB_ID = '00000000-0000-4000-8000-0000000000c1';
const USER_ID = '00000000-0000-4000-8000-00000000000a';

function setup(opts: {
  required: Permission[];
  access: ClubAccess | null;
  user?: { id: string } | undefined;
  params?: Record<string, string>;
}) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(opts.required) } as unknown as Reflector;
  const getClubAccess = vi.fn().mockResolvedValue(opts.access);
  const service = { getClubAccess } as unknown as PermissionService;
  const request: Record<string, unknown> = {
    user: 'user' in opts ? opts.user : { id: USER_ID },
    params: opts.params ?? { clubId: CLUB_ID },
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard: new PermissionGuard(reflector, service), context, request, getClubAccess };
}

async function expectHttpError(promise: Promise<unknown>, statusCode: number, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ statusCode, code });
}

describe('PermissionGuard', () => {
  it('allows a member holding every required permission and attaches their access', async () => {
    const access = new ClubAccess(CLUB_ID, USER_ID, false, 30, [Permission.EventCreate]);
    const { guard, context, request, getClubAccess } = setup({
      required: [Permission.EventCreate],
      access,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getClubAccess).toHaveBeenCalledWith(CLUB_ID, USER_ID);
    expect(request.clubAccess).toBe(access);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const { guard, context } = setup({ required: [], access: null, user: undefined });
    await expectHttpError(guard.canActivate(context), 401, 'UNAUTHORIZED');
  });

  it('rejects a malformed club id with 400 before querying', async () => {
    const { guard, context, getClubAccess } = setup({
      required: [],
      access: null,
      params: { clubId: 'not-a-uuid' },
    });
    await expectHttpError(guard.canActivate(context), 400, 'INVALID_CLUB_ID');
    expect(getClubAccess).not.toHaveBeenCalled();
  });

  it('rejects non-members with 403', async () => {
    const { guard, context } = setup({ required: [], access: null });
    await expectHttpError(guard.canActivate(context), 403, 'NOT_CLUB_MEMBER');
  });

  it('rejects members missing a permission with 403 and lists what is missing', async () => {
    const access = new ClubAccess(CLUB_ID, USER_ID, false, 20, [Permission.CheckinScan]);
    const { guard, context } = setup({
      required: [Permission.CheckinScan, Permission.AnalyticsView],
      access,
    });

    const error = await guard.canActivate(context).catch((e: unknown) => e);
    expect(error).toMatchObject({
      statusCode: 403,
      code: 'MISSING_PERMISSION',
      details: { missing: [Permission.AnalyticsView] },
    });
  });

  it('fails loudly when the route has no :clubId', async () => {
    const { guard, context } = setup({ required: [], access: null, params: {} });
    await expect(guard.canActivate(context)).rejects.toThrow(/without :clubId/);
  });
});
