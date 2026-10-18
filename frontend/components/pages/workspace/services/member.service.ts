import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { JoinRequest, JoinRequestStatus, OrgMember, OrgRole } from "@/types/organisation.interface";
import { MY_ORGANISATIONS } from "./organisation.service";

// Everything that changes who is in a workspace refreshes the same things:
// the member list, the clubs (member counts) and the workspace (pending count).
const workspaceKeys = (orgId: string) => [
  ["orgs", orgId, "members"],
  ["orgs", orgId, "clubs"],
  ["orgs", orgId, "detail"],
  ["orgs", orgId, "join-requests"],
];

/** Everyone in the workspace, owner first. Emails only for moderators and above. */
export const useOrgMembers = (orgId: string | undefined) =>
  useApiQuery<OrgMember[]>(["orgs", orgId ?? "", "members"], { url: `/orgs/${orgId}/members` }, { enabled: !!orgId });

/** Admins and up, for people ranked below them, to roles below their own. */
export const useChangeMemberRole = (orgId: string) =>
  useApiMutation<void, { userId: string; role: Exclude<OrgRole, "owner"> }>(
    ({ userId, role }) => ({ method: "patch", url: `/orgs/${orgId}/members/${userId}`, data: { role } }),
    { invalidates: workspaceKeys(orgId) },
  );

/** Moderators and up, for people ranked below them. Also removes them from every club. */
export const useRemoveMember = (orgId: string) =>
  useApiMutation<void, { userId: string }>(
    ({ userId }) => ({ method: "delete", url: `/orgs/${orgId}/members/${userId}` }),
    { invalidates: workspaceKeys(orgId) },
  );

/** Owner only. You become an admin. */
export const useTransferOwnership = (orgId: string) =>
  useApiMutation<void, { userId: string }>(
    { method: "post", url: `/orgs/${orgId}/transfer-ownership` },
    { invalidates: [...workspaceKeys(orgId), MY_ORGANISATIONS] },
  );

/** Leave the workspace and all its clubs. The owner must hand it over first. */
export const useLeaveOrganisation = (orgId: string) =>
  useApiMutation<void, void>(
    { method: "post", url: `/orgs/${orgId}/leave` },
    { invalidates: [MY_ORGANISATIONS] },
  );

/** Requests to join, newest decisions or oldest pending first (moderators and up). */
export const useJoinRequests = (orgId: string | undefined, status: JoinRequestStatus) =>
  useApiQuery<JoinRequest[]>(
    ["orgs", orgId ?? "", "join-requests", status],
    { url: `/orgs/${orgId}/join-requests`, params: { status } },
    { enabled: !!orgId },
  );

/** Let them in: they join the workspace and its default club. */
export const useApproveJoinRequest = (orgId: string) =>
  useApiMutation<void, { requestId: string }>(
    ({ requestId }) => ({ method: "post", url: `/orgs/${orgId}/join-requests/${requestId}/approve` }),
    { invalidates: workspaceKeys(orgId) },
  );

/** Decline; they can ask again after 24 hours. */
export const useRejectJoinRequest = (orgId: string) =>
  useApiMutation<void, { requestId: string }>(
    ({ requestId }) => ({ method: "post", url: `/orgs/${orgId}/join-requests/${requestId}/reject` }),
    { invalidates: workspaceKeys(orgId) },
  );
