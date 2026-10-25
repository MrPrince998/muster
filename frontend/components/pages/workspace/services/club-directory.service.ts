import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { ClubDirectoryEntry, ClubLinkJoinResult, ClubLinkPreview } from "@/types";
import { MY_ORGANISATIONS } from "./organisation.service";

const directoryKey = (orgId: string) => ["orgs", orgId, "club-directory"];
// joining changes your clubs (the sidebar) and the directory
const joined = (orgId: string) => [directoryKey(orgId), ["orgs", orgId, "clubs"]];

/** The workspace's clubs you can see: ones you're in, and ones that take people without an invite. */
export const useClubDirectory = (orgId: string) =>
  useApiQuery<ClubDirectoryEntry[]>(directoryKey(orgId), { url: `/orgs/${orgId}/club-directory` });

/**
 * Joins an open club at once, or asks to join one that takes requests.
 * CLUB_INVITE_ONLY or ALREADY_IN_CLUB otherwise.
 */
export const useJoinClub = (orgId: string) =>
  useApiMutation<{ status: "joined" | "requested" }, { clubId: string; message?: string }>(
    ({ clubId, message }) => ({ method: "post", url: `/orgs/${orgId}/club-directory/${clubId}/join`, data: { message } }),
    { invalidates: joined(orgId) },
  );

/** A club's own link: not secret, so it follows the club's and the workspace's join settings. */
export const clubLinkUrl = (workspaceSlug: string, clubSlug: string) =>
  `${window.location.origin}/c/${workspaceSlug}/${clubSlug}`;

const linkKey = (workspaceSlug: string, clubSlug: string) => ["club-links", workspaceSlug, clubSlug];

/** Where a club's link leads. CLUB_NOT_FOUND for no such club, or one that takes invite links only. */
export const useClubLinkPreview = (workspaceSlug: string, clubSlug: string) =>
  useApiQuery<ClubLinkPreview>(
    linkKey(workspaceSlug, clubSlug),
    { url: `/club-links/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(clubSlug)}` },
    { retry: false },
  );

/**
 * Joins through a club's link: the club (and the workspace, if it's open),
 * or asks the club, or asks the workspace first when it asks.
 */
export const useJoinByClubLink = (workspaceSlug: string, clubSlug: string) =>
  useApiMutation<ClubLinkJoinResult, { message?: string }>(
    {
      method: "post",
      url: `/club-links/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(clubSlug)}/join`,
    },
    { invalidates: [linkKey(workspaceSlug, clubSlug), MY_ORGANISATIONS, ["orgs"]] },
  );

/** Takes a request back. */
export const useCancelClubRequest = (orgId: string) =>
  useApiMutation<void, { clubId: string }>(
    ({ clubId }) => ({ method: "delete", url: `/orgs/${orgId}/club-directory/${clubId}/join-request` }),
    { invalidates: joined(orgId) },
  );
