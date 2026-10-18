import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { HttpError } from '../../../common/errors/http-error.js';
import { TenantService } from '../../../database/tenant.service.js';
import { OrgRole } from '../entities/org-member.entity.js';
import { orgRoleRank } from '../org-roles.js';

export const MIN_ORG_ROLE_KEY = 'minOrgRole';
export const ORG_ID_PARAM = 'orgId';

/**
 * Lets the request through if the user belongs to the route's workspace
 * (:orgId) with at least the required role. Attach with @RequireOrgRole().
 *
 * Non-members get 404, not 403: whether a workspace exists is none of their
 * business. Members without the role get 403.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenant: TenantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minRole =
      this.reflector.getAllAndOverride<OrgRole>(MIN_ORG_ROLE_KEY, [context.getHandler(), context.getClass()]) ??
      OrgRole.Member;
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) throw HttpError.unauthorized('Sign in required', 'UNAUTHENTICATED');

    const orgId = request.params[ORG_ID_PARAM];
    if (typeof orgId !== 'string') {
      throw new Error(`@RequireOrgRole() used on a route without :${ORG_ID_PARAM}`);
    }
    if (!isUUID(orgId)) throw orgNotFound();

    const userId = request.user.id;
    const rows: { role: OrgRole }[] = await this.tenant.withTenant(orgId, (m) =>
      m.query(`SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`, [orgId, userId]),
    );
    const role = rows[0]?.role;
    if (!role) throw orgNotFound();
    if (orgRoleRank(role) < orgRoleRank(minRole)) {
      throw HttpError.forbidden(`Requires the ${minRole} role in this workspace`, 'INSUFFICIENT_ORG_ROLE');
    }

    request.orgMember = { orgId, userId, role };
    return true;
  }
}

export const orgNotFound = () => HttpError.notFound('Workspace not found', 'ORG_NOT_FOUND');
