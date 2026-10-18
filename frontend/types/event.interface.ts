export type EventVisibility = "members" | "public";
export type EventStatus = "draft" | "published" | "cancelled";
export type EventScope = "upcoming" | "past" | "drafts";

/** GET /clubs/:clubId/events: an event as the signed-in person sees it. */
export interface ClubEvent {
  id: string;
  clubId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string; // ISO
  endsAt: string;
  // null: no limit
  capacity: number | null;
  visibility: EventVisibility;
  status: EventStatus;
  // active registrations, checked-in ones included
  registeredCount: number;
  attendedCount: number;
  youreGoing: boolean;
  // you may edit it: event.manage_any, or event.manage_own as its creator
  canManage: boolean;
}

/** GET .../registrations: someone with an active registration. */
export interface EventAttendee {
  userId: string;
  name: string;
  registeredAt: string;
  checkedInAt: string | null;
}

export interface EventInput {
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  capacity?: number | null;
  visibility?: EventVisibility;
  // create only: publish straight away instead of saving a draft
  publish?: boolean;
}
