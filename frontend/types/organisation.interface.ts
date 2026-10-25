export type OrgRole = "owner" | "admin" | "moderator" | "member";
export type JoinPolicy = "invite" | "request" | "open";

/** One row of GET /orgs: a workspace you belong to. */
export interface MyOrganisation {
  orgId: string;
  name: string;
  slug: string;
  role: OrgRole;
  joinedAt: string;
  // where its events happen: their times are shown in it (IANA name)
  timeZone: string;
}

/** A workspace in full, as POST /orgs and GET /orgs/:id return it. */
export interface Organisation {
  id: string;
  name: string;
  slug: string;
  joinPolicy: JoinPolicy;
  timeZone: string;
  role: OrgRole;
  // moderators and above only: how many are waiting
  pendingJoinRequests?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrganisationInput {
  name: string;
}

/** POST /orgs/by-slug/:slug/join: in at once, or waiting for a moderator. */
export interface JoinResult {
  status: "joined" | "requested";
  organisation?: Organisation;
}

/** GET /orgs/:orgId/members: someone in the workspace. */
export interface OrgMember {
  userId: string;
  name: string;
  // only shown to moderators and above
  email?: string;
  role: OrgRole;
  joinedAt: string;
}

/** GET /orgs/:orgId/members: a page of the members you can see. */
export interface OrgMembersPage {
  members: OrgMember[];
  // pass as `after` for the next page; null at the end
  next: string | null;
  // how many you can see in all (ignoring the search)
  total: number;
}

export type JoinRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

/** GET /orgs/:orgId/join-requests: someone asking to join (moderators and up). */
export interface JoinRequest {
  id: string;
  userId: string;
  name: string;
  email: string;
  message: string | null;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface UpdateOrganisationInput {
  name?: string;
  slug?: string;
  joinPolicy?: JoinPolicy;
  // an IANA name, e.g. "Australia/Perth"
  timeZone?: string;
}
