import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { ClubSummary, CreateClubInput } from "@/types/club.interface";
import type { Organisation } from "@/types/organisation.interface";

export const clubsKey = (orgId: string) => ["orgs", orgId, "clubs"];

/** Your clubs in a workspace (default club first), each with your permissions there. */
export const useClubs = (orgId: string | undefined) =>
  useApiQuery<ClubSummary[]>(clubsKey(orgId ?? ""), { url: `/orgs/${orgId}/clubs` }, { enabled: !!orgId });

/** Creates a club; you hold its Owner role. Workspace admins and owners only. */
export const useCreateClub = (orgId: string) =>
  useApiMutation<ClubSummary, CreateClubInput>(
    { method: "post", url: `/orgs/${orgId}/clubs` },
    { invalidates: [clubsKey(orgId)] },
  );

/** The workspace in full; for moderators and up it includes pendingJoinRequests. */
export const useOrganisation = (orgId: string | undefined) =>
  useApiQuery<Organisation & { pendingJoinRequests?: number }>(
    ["orgs", orgId ?? "", "detail"],
    { url: `/orgs/${orgId}` },
    { enabled: !!orgId },
  );
