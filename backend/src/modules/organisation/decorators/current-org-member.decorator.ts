import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { OrgMembership } from '../org-roles.js';

/** The caller's workspace membership, resolved by @RequireOrgRole(). */
export const CurrentOrgMember = createParamDecorator((_data: unknown, context: ExecutionContext): OrgMembership => {
  const member = context.switchToHttp().getRequest<Request>().orgMember;
  if (!member) throw new Error('@CurrentOrgMember() used on a route without @RequireOrgRole()');
  return member;
});
