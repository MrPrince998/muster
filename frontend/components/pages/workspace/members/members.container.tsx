"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMe } from "@/components/pages/auth/services/auth.service";
import type { OrgMember, OrgRole } from "@/types/organisation.interface";
import { ROLE_RANK, useWorkspace } from "../org-shell/workspace-context";
import {
  useChangeMemberRole,
  useLeaveOrganisation,
  useOrgMembers,
  useRemoveMember,
  useTransferOwnership,
} from "../services/member.service";
import { workspaceErrorMessage } from "../shared/workspace-errors";
import MembersView, { type MemberAction } from "./members.view";

// the roles someone may hand out: strictly below their own (owner moves by transfer)
const ASSIGNABLE: Record<OrgRole, Exclude<OrgRole, "owner">[]> = {
  owner: ["admin", "moderator", "member"],
  admin: ["moderator", "member"],
  moderator: [],
  member: [],
};

/** /o/[slug]/members: everyone in the workspace, and what you may do about each. */
export default function MembersContainer() {
  const router = useRouter();
  const { organisation, rank, clubs } = useWorkspace();
  const orgId = organisation.orgId;
  const me = useMe();
  const members = useOrgMembers(orgId);
  // ?q= fills the filter: a person picked in search
  const qParam = useSearchParams().get("q") ?? "";
  const [query, setQuery] = useState(qParam);
  const [shownQ, setShownQ] = useState(qParam);
  if (qParam !== shownQ) {
    setShownQ(qParam);
    setQuery(qParam);
  }
  // the action waiting for confirmation in the dialog
  const [confirming, setConfirming] = useState<MemberAction | null>(null);
  // clubs you can make invite links for (default club first); the dialog opens on one
  const invitableClubs = clubs.data.filter((club) => club.permissions.includes("invite.manage"));
  const [invitingTo, setInvitingTo] = useState<string | null>(null);

  const changeRole = useChangeMemberRole(orgId);
  const remove = useRemoveMember(orgId);
  const transfer = useTransferOwnership(orgId);
  const leave = useLeaveOrganisation(orgId);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = members.data ?? [];
    if (!needle) return list;
    return list.filter(
      (member) => member.name.toLowerCase().includes(needle) || member.email?.toLowerCase().includes(needle),
    );
  }, [members.data, query]);

  /** What your rank lets you do to this person (nothing to yourself here: you leave instead). */
  const actionsFor = (member: OrgMember) => {
    const theirs = ROLE_RANK[member.role];
    const isMe = member.userId === me.data?.id;
    const below = !isMe && theirs < rank;
    return {
      roles: below ? ASSIGNABLE[organisation.role].filter((role) => role !== member.role) : [],
      canRemove: below && rank >= ROLE_RANK.moderator,
      canMakeOwner: !isMe && organisation.role === "owner",
    };
  };

  // run the confirmed action; a message back means it failed and stays in the dialog
  const runConfirmed = async (): Promise<string | null> => {
    if (!confirming) return null;
    try {
      switch (confirming.kind) {
        case "role":
          await changeRole.mutateAsync({ userId: confirming.member.userId, role: confirming.role });
          break;
        case "remove":
          await remove.mutateAsync({ userId: confirming.member.userId });
          break;
        case "owner":
          await transfer.mutateAsync({ userId: confirming.member.userId });
          break;
        case "leave":
          await leave.mutateAsync();
          router.replace("/workspaces");
          break;
      }
      return null;
    } catch (error) {
      return workspaceErrorMessage(error);
    }
  };

  return (
    <MembersView
      members={visible}
      total={members.data?.length ?? 0}
      loading={members.isPending}
      failed={members.isError}
      onRetry={() => members.refetch()}
      query={query}
      onQueryChange={setQuery}
      myId={me.data?.id ?? null}
      myRole={organisation.role}
      workspaceName={organisation.name}
      actionsFor={actionsFor}
      confirming={confirming}
      onConfirm={setConfirming}
      runConfirmed={runConfirmed}
      invitableClubs={invitableClubs}
      invitingTo={invitingTo}
      onInvite={setInvitingTo}
    />
  );
}
