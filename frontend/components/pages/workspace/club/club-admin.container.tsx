"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { asApiError } from "@/lib/api/client";
import { useMe } from "../../auth/services/auth.service";
import { useWorkspace } from "../org-shell/workspace-context";
import {
  useClubMembers,
  useClubSettings,
  useCreateRole,
  useDeleteRole,
  useLeaveClub,
  useMoveRole,
  useRemoveClubMember,
  useSetMemberRoles,
  useTransferClub,
  useUpdateClubSettings,
  useUpdateRole,
} from "../services/club-admin.service";
import { useClubAttendance } from "../services/analytics.service";
import { clubLinkUrl } from "../services/club-directory.service";
import { useClubRoles } from "../services/invite.service";
import InviteDialog from "../dialogs/invite-dialog";
import { InviteLinks } from "../members/parts/invite-links";
import { AttendanceTab } from "./parts/attendance-tab";
import { ClubRequestQueue } from "./parts/club-request-queue";
import { GeneralTab } from "./parts/general-tab";
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

type SettingsTab = "general" | "members" | "requests" | "invites" | "roles" | "attendance";

/**
 * /o/[slug]/clubs/[clubId]: the club's settings. Everything about running
 * the club in one place: its name and who can join, its members, people
 * waiting to join, its invite links, roles and attendance. Each tab shows
 * for the people it's useful to.
 */
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
  const settings = useClubSettings(club?.id);
  const updateSettings = useUpdateClubSettings(clubId, orgId);
  const [inviting, setInviting] = useState(false);
  const seesAttendance = !!club?.permissions.includes("analytics.view");
  const approves = !!club?.permissions.includes("member.approve");
  const invites = !!club?.permissions.includes("invite.manage");
  const attendance = useClubAttendance(club?.id, seesAttendance);
  // the tabs you may see; anything else lands on general
  const shown: Record<SettingsTab, boolean> = {
    general: true,
    members: true,
    requests: approves,
    invites,
    roles: true,
    attendance: seesAttendance,
  };
  const tab: SettingsTab = tabParam && tabParam in shown && shown[tabParam as SettingsTab] ? (tabParam as SettingsTab) : "general";

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
      <h1 className="mt-3 text-5xl leading-none font-extrabold font-stretch-70%">Club settings</h1>
      <p className="mt-2 text-muted-foreground">
        {club.name}: {club.memberCount} {club.memberCount === 1 ? "member" : "members"}
        {owner ? `, owned by ${owner.userId === me.data?.id ? "you" : owner.name}` : ""}.
      </p>

      <Tabs
        value={tab}
        onValueChange={(value) => router.replace(value === "general" ? pathname : `${pathname}?tab=${value}`, { scroll: false })}
        className="mt-8"
      >
        <TabsList variant="line" className="h-10 w-full justify-start gap-4 overflow-x-auto border-b p-0">
          <TabsTrigger value="general" className="flex-none px-0 text-[15px] data-active:text-cobalt-800">
            General
          </TabsTrigger>
          <TabsTrigger value="members" className="flex-none px-0 text-[15px] data-active:text-cobalt-800">
            Members
            {members.data && <span className="text-xs text-muted-foreground tabular-nums">{members.data.length}</span>}
          </TabsTrigger>
          {approves && (
            <TabsTrigger value="requests" className="flex-none px-0 text-[15px] data-active:text-cobalt-800">
              Join requests
              {club.pendingJoinRequests > 0 && (
                <span className="rounded-full bg-cobalt px-1.5 text-xs font-bold text-white tabular-nums">
                  {club.pendingJoinRequests}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </TabsTrigger>
          )}
          {invites && (
            <TabsTrigger value="invites" className="flex-none px-0 text-[15px] data-active:text-cobalt-800">
              Invite links
            </TabsTrigger>
          )}
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
        {tab === "general" ? (
          settings.data ? (
            <GeneralTab
              key={club.id}
              settings={settings.data}
              workspaceName={organisation.name}
              clubLink={clubLinkUrl(organisation.slug, club.slug)}
              canEdit={iAmOwner || mine.has("role.manage")}
              onSave={(changes) => attempt(() => updateSettings.mutateAsync(changes))}
            />
          ) : settings.isError ? (
            <p className="text-muted-foreground">
              Couldn&rsquo;t load the club&rsquo;s settings.{" "}
              <button type="button" onClick={() => settings.refetch()} className="font-medium text-cobalt underline-offset-4 hover:underline">
                Try again
              </button>
            </p>
          ) : (
            <div className="h-64 max-w-2xl animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-hidden />
          )
        ) : tab === "requests" ? (
          <ClubRequestQueue club={club} orgId={orgId} />
        ) : tab === "invites" ? (
          <>
            <InviteLinks clubs={[club]} onCreate={() => setInviting(true)} className="" />
            {inviting && (
              <InviteDialog open onOpenChange={(open) => !open && setInviting(false)} clubs={[club]} initialClubId={club.id} />
            )}
          </>
        ) : tab === "attendance" ? (
          <AttendanceTab
            data={attendance.data}
            loading={attendance.isPending}
            failed={attendance.isError}
            onRetry={() => attendance.refetch()}
            eventHref={(eventId) => `/o/${organisation.slug}?club=${clubId}&event=${eventId}`}
            timeZone={organisation.timeZone}
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
