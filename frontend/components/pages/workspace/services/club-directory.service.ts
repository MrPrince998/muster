import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { ClubDirectoryEntry } from "@/types";

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

/** Takes a request back. */
export const useCancelClubRequest = (orgId: string) =>
  useApiMutation<void, { clubId: string }>(
    ({ clubId }) => ({ method: "delete", url: `/orgs/${orgId}/club-directory/${clubId}/join-request` }),
    { invalidates: joined(orgId) },
  );
