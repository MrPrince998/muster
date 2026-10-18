"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { asApiError } from "@/lib/api/client";
import { useMe } from "../../auth/services/auth.service";
import { useWorkspace } from "../org-shell/workspace-context";
import {
  useClubMembers,
  useCreateRole,
  useDeleteRole,
  useLeaveClub,
  useMoveRole,
  useRemoveClubMember,
  useSetMemberRoles,
  useTransferClub,
  useUpdateRole,
} from "../services/club-admin.service";
import { useClubAttendance } from "../services/analytics.service";
import { useClubRoles } from "../services/invite.service";
import { AttendanceTab } from "./parts/attendance-tab";
import { MembersTab } from "./parts/members-tab";
import { RolesTab } from "./parts/roles-tab";

/** What each refusal means, in the dialog that asked. */
function adminMessage(code: string): string {
  switch (code) {
    case "MEMBER_ABOVE_YOU":
      return "They're at or above you in the club, so you can't change that.";
    case "ROLE_ABOVE_YOU":
      return "That role is at or above your own, so you can't change it.";
    case "PERMISSION_NOT_YOURS":
      return "A role can't be given permissions you don't have yourself.";
    case "ROLE_NAME_TAKEN":
      return "The club already has a role with that name.";
    case "TOO_MANY_ROLES":
      return "A club can have up to 25 roles. Delete one first.";
    case "ROLE_AT_EDGE":
      return "It can't move any further that way.";
    case "OWNS_CLUB":
      return "You own this club. Make someone else the owner first.";
    case "DEFAULT_CLUB":
      return "Everyone in the workspace is in this club. That happens through the workspace instead.";
    case "MEMBER_NOT_FOUND":
      return "They're no longer in the club.";
    case "ROLE_NOT_FOUND":
      return "That role no longer exists. Close this and try again.";
    case "NOT_OWNER":
    case "MISSING_PERMISSION":
      return "You don't have permission to do that in this club.";
    case "NETWORK_ERROR":
      return "Can't reach Muster. Check your connection, then try again.";
    default:
      return "Something went wrong on our side. Try again in a moment.";
  }
}

const attempt = async (work: () => Promise<unknown>): Promise<string | null> => {
  try {
    await work();
    return null;
  } catch (error) {
    return adminMessage(asApiError(error).code);
  }
};

/** /o/[slug]/clubs/[clubId]: a club's members and roles, and what you may change. */
export default function ClubAdminContainer() {
  const { clubId } = useParams<{ clubId: string }>();
  const { organisation, clubs } = useWorkspace();
  const club = clubs.data.find((c) => c.id === clubId) ?? null;
  const orgId = organisation.orgId;
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const me = useMe();

  const members = useClubMembers(club?.id);
  const roles = useClubRoles(club?.id);
  const setRoles = useSetMemberRoles(clubId, orgId);
  const remove = useRemoveClubMember(clubId, orgId);
  const leave = useLeaveClub(clubId, orgId);
  const transfer = useTransferClub(clubId, orgId);
  const createRole = useCreateRole(clubId, orgId);
  const updateRole = useUpdateRole(clubId, orgId);
  const moveRole = useMoveRole(clubId, orgId);
  const deleteRole = useDeleteRole(clubId, orgId);
  const seesAttendance = !!club?.permissions.includes("analytics.view");
  const attendance = useClubAttendance(club?.id, seesAttendance);
  // attendance only for those who may see it; anything else lands on members
  const tab = tabParam === "roles" ? "roles" : tabParam === "attendance" && seesAttendance ? "attendance" : "members";

  const back = `/o/${organisation.slug}?club=${clubId}`;

  if (clubs.loading) {
    return (
      <section className="w-full max-w-4xl px-5 py-6 sm:px-8 lg:py-8" role="status">
        <div className="h-12 w-64 max-w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <span className="sr-only">Loading the club</span>
      </section>
    );
  }
  if (!club) {
    return (
      <section className="w-full max-w-4xl space-y-3 px-5 py-6 sm:px-8 lg:py-8">
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">You&rsquo;re not in this club</h1>
        <p className="text-muted-foreground">Ask someone in it for an invite link, or pick one of your clubs.</p>
        <Link href={`/o/${organisation.slug}`} className="inline-block font-medium text-cobalt underline-offset-4 hover:underline">
          Back to {organisation.name}
        </Link>
      </section>
    );
  }

  const mine = new Set(club.permissions);
  const list = members.data ?? [];
  const owner = list.find((m) => m.isOwner) ?? null;
  const iAmOwner = !!owner && owner.userId === me.data?.id;

  return (
    <section className="w-full max-w-4xl px-5 py-6 sm:px-8 lg:py-8">
      <Link
        href={back}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {club.name} events
      </Link>
      <h1 className="mt-3 text-5xl leading-none font-extrabold font-stretch-70%">{club.name}</h1>
      <p className="mt-2 text-muted-foreground">
        {club.memberCount} {club.memberCount === 1 ? "member" : "members"} in {organisation.name}
        {owner ? `, owned by ${owner.userId === me.data?.id ? "you" : owner.name}` : ""}.
      </p>

      <Tabs
        value={tab}
        onValueChange={(value) => router.replace(value === "members" ? pathname : `${pathname}?tab=${value}`, { scroll: false })}
        className="mt-8"
      >
        <TabsList variant="line" className="h-10 gap-4 border-b p-0">
          <TabsTrigger value="members" className="flex-none px-0 text-[15px] data-active:text-cobalt-800">
            Members
            {members.data && <span className="text-xs text-muted-foreground tabular-nums">{members.data.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="roles" className="flex-none px-0 text-[15px] data-active:text-cobalt-800">
            Roles
            {roles.data && <span className="text-xs text-muted-foreground tabular-nums">{roles.data.length + 1}</span>}
          </TabsTrigger>
          {seesAttendance && (
            <TabsTrigger value="attendance" className="flex-none px-0 text-[15px] data-active:text-cobalt-800">
              Attendance
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      <div className="mt-6">
        {tab === "attendance" ? (
          <AttendanceTab
            data={attendance.data}
            loading={attendance.isPending}
            failed={attendance.isError}
            onRetry={() => attendance.refetch()}
            eventHref={(eventId) => `/o/${organisation.slug}?club=${clubId}&event=${eventId}`}
          />
        ) : tab === "members" ? (
          <MembersTab
            clubName={club.name}
            isDefault={club.isDefault}
            members={list}
            roles={roles.data ?? []}
            loading={members.isPending || roles.isPending}
            failed={members.isError || roles.isError}
            onRetry={() => {
              members.refetch();
              roles.refetch();
            }}
            myId={me.data?.id}
            iAmOwner={iAmOwner}
            canManageRoles={mine.has("role.manage")}
            canRemove={mine.has("member.remove")}
            onSetRoles={(userId, roleIds) => attempt(() => setRoles.mutateAsync({ userId, roleIds }))}
            onRemove={(userId) => attempt(() => remove.mutateAsync({ userId }))}
            onTransfer={(userId) => attempt(() => transfer.mutateAsync({ userId }))}
            onLeave={() =>
              attempt(async () => {
                await leave.mutateAsync();
                router.replace(`/o/${organisation.slug}`);
              })
            }
          />
        ) : (
          <RolesTab
            clubName={club.name}
            roles={roles.data ?? []}
            ownerName={owner ? (owner.userId === me.data?.id ? "You" : owner.name) : null}
            loading={roles.isPending}
            failed={roles.isError}
            onRetry={() => roles.refetch()}
            canManageRoles={mine.has("role.manage")}
            mine={mine}
            onCreate={(input) => attempt(() => createRole.mutateAsync(input))}
            onUpdate={(roleId, input) => attempt(() => updateRole.mutateAsync({ roleId, ...input }))}
            onMove={(roleId, direction) => attempt(() => moveRole.mutateAsync({ roleId, direction }))}
            onDelete={(roleId) => attempt(() => deleteRole.mutateAsync({ roleId }))}
          />
        )}
      </div>
    </section>
  );
}
