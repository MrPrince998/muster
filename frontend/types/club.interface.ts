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

/** Who can join a club: anyone in the workspace, by asking, or only with an invite link. */
export type ClubJoinPolicy = "open" | "request" | "invite";

/** GET /orgs/:orgId/clubs: a club you belong to, with what you may do in it. */
export interface ClubSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  // the workspace's default club: everyone who joins is in it
  isDefault: boolean;
  joinPolicy: ClubJoinPolicy;
  memberCount: number;
  upcomingCount: number;
  // people waiting to join (they asked, or used a link that needs approval); 0 unless you can approve
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

/** GET /clubs/:clubId/settings: the club's own settings. */
export interface ClubSettings {
  id: string;
  name: string;
  description: string | null;
  joinPolicy: ClubJoinPolicy;
  isDefault: boolean;
}

export interface UpdateClubSettingsInput {
  name?: string;
  description?: string;
  joinPolicy?: ClubJoinPolicy;
}

/** GET /orgs/:orgId/club-directory: a club you can see in the workspace (not invite-only ones you aren't in). */
export interface ClubDirectoryEntry {
  id: string;
  name: string;
  // in the club's link: /c/{workspace}/{club}
  slug: string;
  description: string | null;
  joinPolicy: ClubJoinPolicy;
  memberCount: number;
  upcomingCount: number;
  isMember: boolean;
  // asked to join, and nobody has decided yet
  requested: boolean;
}

/** GET /club-links/:orgSlug/:clubSlug: where a club's link leads, before joining. */
export interface ClubLinkPreview {
  workspaceName: string;
  workspaceSlug: string;
  workspaceJoinPolicy: ClubJoinPolicy;
  inWorkspace: boolean;
  // asked to join the workspace, and nobody has decided yet
  workspaceRequested: boolean;
  clubId: string;
  clubName: string;
  description: string | null;
  // the workspace's General club: joining it is joining the workspace
  isDefault: boolean;
  joinPolicy: ClubJoinPolicy;
  memberCount: number;
  isMember: boolean;
  requested: boolean;
}

export interface ClubLinkJoinResult {
  // workspace_requested: the workspace asks first; open the link again once its moderators let you in
  status: "joined" | "requested" | "workspace_requested";
  workspaceSlug: string;
  clubId: string;
}
