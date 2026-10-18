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
  // false: registration closed early (the event still runs)
  registrationOpen: boolean;
  cancelledAt: string | null;
  // the organisers' note, sent with the cancellation
  cancelReason: string | null;
  // active registrations, checked-in ones included
  registeredCount: number;
  attendedCount: number;
  youreGoing: boolean;
  // people waiting for a place, and your place among them (from 1; null if not waiting)
  waitlistCount: number;
  yourWaitlistPosition: number | null;
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

/** PATCH: any of the fields, plus opening or closing registration. */
export type EventChanges = Partial<Omit<EventInput, "publish">> & { registrationOpen?: boolean };
