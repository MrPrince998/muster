import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type {
  CreateOrganisationInput,
  JoinResult,
  MyOrganisation,
  Organisation,
  UpdateOrganisationInput,
} from "@/types/organisation.interface";

export const MY_ORGANISATIONS = ["orgs", "mine"];

/** The workspaces you belong to, oldest membership first. */
export const useMyOrganisations = () =>
  useApiQuery<MyOrganisation[]>(MY_ORGANISATIONS, { url: "/orgs" });

/** Creates a workspace with you as owner; it starts with a club called General. */
export const useCreateOrganisation = () =>
  useApiMutation<Organisation, CreateOrganisationInput>(
    { method: "post", url: "/orgs" },
    { invalidates: [MY_ORGANISATIONS] },
  );

/**
 * Joins a workspace by its address. Open workspaces let you in at once
 * ("joined"); others take a request a moderator reviews ("requested").
 * Fails with ORG_NOT_FOUND (no such workspace, or invite links only),
 * ALREADY_MEMBER, REQUEST_PENDING or REQUEST_RECENTLY_REJECTED.
 */
export const useJoinOrganisation = () =>
  useApiMutation<JoinResult, { slug: string }>(
    ({ slug }) => ({ method: "post", url: `/orgs/by-slug/${encodeURIComponent(slug)}/join`, data: {} }),
    { invalidates: [MY_ORGANISATIONS] },
  );

/** Name, URL or join policy (admins and the owner). Fails with SLUG_TAKEN. */
export const useUpdateOrganisation = (orgId: string) =>
  useApiMutation<Organisation, UpdateOrganisationInput>(
    { method: "patch", url: `/orgs/${orgId}` },
    { invalidates: [MY_ORGANISATIONS, ["orgs", orgId, "detail"]] },
  );

/** Owner only; type the URL (slug) to confirm. Deletes every club, event and registration. */
export const useDeleteOrganisation = (orgId: string) =>
  useApiMutation<void, { confirmSlug: string }>(
    { method: "delete", url: `/orgs/${orgId}` },
    { invalidates: [MY_ORGANISATIONS] },
  );
