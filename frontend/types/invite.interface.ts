export type InviteStatus = "active" | "expired" | "used_up" | "revoked";

/** GET /clubs/:clubId/invites: a link that hasn't been turned off. */
export interface Invite {
  id: string;
  // the secret in the link: /join/{code}
  code: string;
  clubId: string;
  role: { id: string; name: string } | null;
  // null: no limit / never
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  status: InviteStatus;
  // people ask to join and someone approves each one
  requiresApproval: boolean;
  createdByName: string | null;
  createdAt: string;
}

export interface CreateInviteInput {
  defaultRoleId?: string | null;
  maxUses?: number | null;
  expiresInDays?: number | null;
  requiresApproval?: boolean;
}

/** GET /invites/:code: what a link leads to, before joining. */
export interface InvitePreview {
  status: InviteStatus;
  workspaceName: string;
  workspaceSlug: string;
  clubId: string;
  clubName: string;
  // the default club: the link is really an invite to the workspace
  clubIsDefault: boolean;
  roleName: string | null;
  alreadyMember: boolean;
  // joining means asking; someone approves each person
  requiresApproval: boolean;
  // you already asked and are waiting
  pendingRequest: boolean;
}

export interface AcceptInviteResult {
  workspaceSlug: string;
  clubId: string;
  // requested: the link needs approval and you're now waiting
  status: "joined" | "already_member" | "requested";
}

/** GET /clubs/:clubId/join-requests: someone waiting to be let into a club. */
export interface ClubJoinRequest {
  id: string;
  userId: string;
  name: string;
  email: string;
  // the role approving gives, from the link they used
  roleName: string | null;
  createdAt: string;
}

/** GET /clubs/:clubId/roles: a club role, and whether you can give it. */
export interface ClubRole {
  id: string;
  name: string;
  position: number;
  assignable: boolean;
}
