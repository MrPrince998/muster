/** Every club permission (backend: modules/permission/permissions.ts). */
export type ClubPermission =
  | "event.create"
  | "event.publish"
  | "event.manage_own"
  | "event.manage_any"
  | "registration.view"
  | "checkin.scan"
  | "analytics.view"
  | "member.approve"
  | "member.remove"
  | "invite.manage"
  | "role.manage";

/** GET /orgs/:orgId/clubs: a club you belong to, with what you may do in it. */
export interface ClubSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  // the workspace's default club: everyone who joins is in it
  isDefault: boolean;
  memberCount: number;
  upcomingCount: number;
  // people waiting to join through links that need approval; 0 unless you can approve
  pendingJoinRequests: number;
  permissions: ClubPermission[];
}

export interface CreateClubInput {
  name: string;
  description?: string;
}

/** GET /clubs/:clubId/members: someone in the club, with their roles. */
export interface ClubMember {
  userId: string;
  name: string;
  joinedAt: string;
  // holds the Owner role
  isOwner: boolean;
  // the roles they hold, most senior first (Owner not included)
  roleIds: string[];
  // below you: you may change their roles or remove them
  manageable: boolean;
}

export interface RoleInput {
  name: string;
  permissions: ClubPermission[];
}
