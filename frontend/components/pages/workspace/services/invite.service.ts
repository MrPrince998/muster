import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type {
  AcceptInviteResult,
  ClubJoinRequest,
  ClubRole,
  CreateInviteInput,
  Invite,
  InvitePreview,
} from "@/types/invite.interface";
import { MY_ORGANISATIONS } from "./organisation.service";

const invitesKey = (clubId: string) => ["clubs", clubId, "invites"];

/** A club's links that haven't been turned off. Needs invite.manage. */
export const useClubInvites = (clubId: string | undefined) =>
  useApiQuery<Invite[]>(invitesKey(clubId ?? ""), { url: `/clubs/${clubId}/invites` }, { enabled: !!clubId });

/** A club's roles (no Owner), each marked if you can give it. */
export const useClubRoles = (clubId: string | undefined) =>
  useApiQuery<ClubRole[]>(["clubs", clubId ?? "", "roles"], { url: `/clubs/${clubId}/roles` }, { enabled: !!clubId });

/** Creates a link. Fails with ROLE_TOO_HIGH if the role isn't below yours. */
export const useCreateInvite = (clubId: string) =>
  useApiMutation<Invite, CreateInviteInput>(
    { method: "post", url: `/clubs/${clubId}/invites` },
    { invalidates: [invitesKey(clubId)] },
  );

/** Turns a link off for good. */
export const useRevokeInvite = (clubId: string) =>
  useApiMutation<void, { inviteId: string }>(
    ({ inviteId }) => ({ method: "delete", url: `/clubs/${clubId}/invites/${inviteId}` }),
    { invalidates: [invitesKey(clubId)] },
  );

/** Where a link leads, and whether it still works. */
export const useInvitePreview = (code: string) =>
  useApiQuery<InvitePreview>(["invites", code], { url: `/invites/${encodeURIComponent(code)}` }, { retry: false });

/**
 * Joins through a link: the workspace (if needed), its General club, and the
 * link's club, with the link's role. Fails with INVITE_USED_UP, INVITE_EXPIRED,
 * INVITE_REVOKED or INVITE_NOT_FOUND.
 */
export const useAcceptInvite = (code: string) =>
  useApiMutation<AcceptInviteResult, void>(
    { method: "post", url: `/invites/${encodeURIComponent(code)}/accept` },
    // the rail and clubs change: you're in somewhere new
    { invalidates: [MY_ORGANISATIONS, ["orgs"], ["invites", code]] },
  );

/** People waiting to get into a club (member.approve). */
export const useClubJoinRequests = (clubId: string | undefined) =>
  useApiQuery<ClubJoinRequest[]>(["clubs", clubId ?? "", "join-requests"], { url: `/clubs/${clubId}/join-requests` }, { enabled: !!clubId });

// deciding changes the queue, the clubs (member and pending counts) and the members list
const decided = (clubId: string, orgId: string) => [
  ["clubs", clubId, "join-requests"],
  ["orgs", orgId, "clubs"],
  ["orgs", orgId, "members"],
];

/** Lets them in, with the role of the link they used. */
export const useApproveClubRequest = (clubId: string, orgId: string) =>
  useApiMutation<void, { requestId: string }>(
    ({ requestId }) => ({ method: "post", url: `/clubs/${clubId}/join-requests/${requestId}/approve` }),
    { invalidates: decided(clubId, orgId) },
  );

export const useRejectClubRequest = (clubId: string, orgId: string) =>
  useApiMutation<void, { requestId: string }>(
    ({ requestId }) => ({ method: "post", url: `/clubs/${clubId}/join-requests/${requestId}/reject` }),
    { invalidates: decided(clubId, orgId) },
  );

/** The link people open. */
export const inviteUrl = (code: string) => `${window.location.origin}/join/${code}`;
