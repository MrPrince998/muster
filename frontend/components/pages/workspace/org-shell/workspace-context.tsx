"use client";

import { createContext, useContext } from "react";
import type { ClubSummary } from "@/types/club.interface";
import type { MyOrganisation, Organisation, OrgRole } from "@/types/organisation.interface";

export const ROLE_RANK: Record<OrgRole, number> = { member: 1, moderator: 2, admin: 3, owner: 4 };

/** What your workspace role lets you do (club permissions are separate, per club). */
export interface WorkspaceAbilities {
  // everyone can see who's in the workspace; staff also see emails
  seeMembers: boolean;
  reviewJoinRequests: boolean;
  changeSettings: boolean;
  createClubs: boolean;
}

export interface WorkspaceContextValue {
  // clubs where you can approve people who asked to join (member.approve)
  approvableClubs: ClubSummary[];
  organisation: MyOrganisation;
  // the workspace in full (join policy, pending requests); undefined while loading
  detail: Organisation | undefined;
  rank: number;
  can: WorkspaceAbilities;
  clubs: { data: ClubSummary[]; loading: boolean; failed: boolean; retry: () => void };
  openCreateClub: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

/** The open workspace, for any page under /o/[slug]. */
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace() used outside /o/[slug]");
  return value;
}

export function abilitiesFor(role: OrgRole): WorkspaceAbilities {
  const rank = ROLE_RANK[role];
  return {
    seeMembers: true,
    reviewJoinRequests: rank >= ROLE_RANK.moderator,
    changeSettings: rank >= ROLE_RANK.admin,
    createClubs: rank >= ROLE_RANK.admin,
  };
}
