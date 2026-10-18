import { OrgRole } from './entities/org-member.entity.js';

const RANK: Record<OrgRole, number> = {
  [OrgRole.Member]: 1,
  [OrgRole.Moderator]: 2,
  [OrgRole.Admin]: 3,
  [OrgRole.Owner]: 4,
};

/** owner > admin > moderator > member */
export function orgRoleRank(role: OrgRole): number {
  return RANK[role];
}

/** The caller's membership, resolved by OrgMemberGuard. */
export interface OrgMembership {
  orgId: string;
  userId: string;
  role: OrgRole;
}

declare global {
  namespace Express {
    interface Request {
      // set by @RequireOrgRole(); read it with @CurrentOrgMember()
      orgMember?: OrgMembership;
    }
  }
}
