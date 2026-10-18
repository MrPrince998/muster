import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { ClubMember, ClubRole, RoleInput } from "@/types";

const membersKey = (clubId: string) => ["clubs", clubId, "members"];
const rolesKey = (clubId: string) => ["clubs", clubId, "roles"];
// role changes can change anyone's permissions (yours after a transfer), and the clubs list carries yours
const refreshes = (clubId: string, orgId: string) => [membersKey(clubId), rolesKey(clubId), ["orgs", orgId, "clubs"]];

/** Everyone in the club, senior first, with their roles. Any member may look. */
export const useClubMembers = (clubId: string | undefined) =>
  useApiQuery<ClubMember[]>(membersKey(clubId ?? ""), { url: `/clubs/${clubId}/members` }, { enabled: !!clubId });

/** Replaces someone's roles. MEMBER_ABOVE_YOU or ROLE_ABOVE_YOU outside your reach. */
export const useSetMemberRoles = (clubId: string, orgId: string) =>
  useApiMutation<ClubMember, { userId: string; roleIds: string[] }>(
    ({ userId, roleIds }) => ({ method: "put", url: `/clubs/${clubId}/members/${userId}/roles`, data: { roleIds } }),
    { invalidates: refreshes(clubId, orgId) },
  );

/** Takes someone out of the club. DEFAULT_CLUB for the workspace's default club. */
export const useRemoveClubMember = (clubId: string, orgId: string) =>
  useApiMutation<void, { userId: string }>(
    ({ userId }) => ({ method: "delete", url: `/clubs/${clubId}/members/${userId}` }),
    { invalidates: refreshes(clubId, orgId) },
  );

/** Leaves the club. OWNS_CLUB until you hand it over; DEFAULT_CLUB for the default club. */
export const useLeaveClub = (clubId: string, orgId: string) =>
  useApiMutation<void, void>(
    { method: "delete", url: `/clubs/${clubId}/members/me` },
    { invalidates: refreshes(clubId, orgId) },
  );

/** Hands the club to another member (owner only). */
export const useTransferClub = (clubId: string, orgId: string) =>
  useApiMutation<void, { userId: string }>(
    { method: "post", url: `/clubs/${clubId}/transfer-ownership` },
    { invalidates: refreshes(clubId, orgId) },
  );

/** A new role, at the bottom. PERMISSION_NOT_YOURS, ROLE_NAME_TAKEN, TOO_MANY_ROLES. */
export const useCreateRole = (clubId: string, orgId: string) =>
  useApiMutation<ClubRole[], RoleInput>(
    { method: "post", url: `/clubs/${clubId}/roles` },
    { invalidates: refreshes(clubId, orgId) },
  );

export const useUpdateRole = (clubId: string, orgId: string) =>
  useApiMutation<ClubRole[], { roleId: string } & Partial<RoleInput>>(
    ({ roleId, ...changes }) => ({ method: "patch", url: `/clubs/${clubId}/roles/${roleId}`, data: changes }),
    { invalidates: refreshes(clubId, orgId) },
  );

export const useMoveRole = (clubId: string, orgId: string) =>
  useApiMutation<ClubRole[], { roleId: string; direction: "up" | "down" }>(
    ({ roleId, direction }) => ({ method: "post", url: `/clubs/${clubId}/roles/${roleId}/move`, data: { direction } }),
    { invalidates: refreshes(clubId, orgId) },
  );

export const useDeleteRole = (clubId: string, orgId: string) =>
  useApiMutation<void, { roleId: string }>(
    ({ roleId }) => ({ method: "delete", url: `/clubs/${clubId}/roles/${roleId}` }),
    { invalidates: refreshes(clubId, orgId) },
  );
