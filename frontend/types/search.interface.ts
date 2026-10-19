import type { EventStatus } from "./event.interface";

interface InWorkspace {
  orgName: string;
  orgSlug: string;
}

export interface WorkspaceHit {
  orgId: string;
  name: string;
  slug: string;
  // your role there
  role: string;
}

export interface ClubHit extends InWorkspace {
  id: string;
  name: string;
}

export interface EventHit extends InWorkspace {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  // already over
  ended: boolean;
  // its workspace's time zone
  timeZone: string;
  clubId: string;
  clubName: string;
}

export interface PersonHit extends InWorkspace {
  userId: string;
  name: string;
  // their role in that workspace
  role: string;
}

/** GET /search?q=: a handful of each kind, best match first. */
export interface SearchResult {
  workspaces: WorkspaceHit[];
  clubs: ClubHit[];
  events: EventHit[];
  people: PersonHit[];
}
