export type EventVisibility = "members" | "public";
export type EventStatus = "draft" | "published" | "cancelled";
export type EventScope = "upcoming" | "past" | "drafts";
export type RepeatEvery = "week" | "fortnight" | "month";
// for an event in a series: just this one, or this and the ones after it
export type SeriesScope = "this" | "following";

/** The series a recurring event belongs to. */
export interface EventSeries {
  id: string;
  every: RepeatEvery;
  // which one this is, from 1, by date; and how many in all
  index: number;
  count: number;
}

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
  // null for a one-off
  series: EventSeries | null;
  // a ticket's price; null: free
  price: Price | null;
  // a paid place given back at least this many hours before the start is refunded
  refundCutoffHours: number;
  // places held by people paying for them right now
  heldCount: number;
  // what you paid for your place, and whether giving it back now refunds it
  yourPayment: (Price & { refundable: boolean }) | null;
  // takings less refunds; only for people who can edit it
  salesCents: number | null;
}

/** A price in the currency's smallest unit: 1500 is $15.00. */
export interface Price {
  amountCents: number;
  // ISO 4217, lowercase: "aud"
  currency: string;
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
  // a ticket's price in cents; null: free (needs the workspace's Stripe account)
  priceCents?: number | null;
  refundCutoffHours?: number;
  // create only: the same event every week, fortnight or month, `count` in all
  repeat?: { every: RepeatEvery; count: number };
}

/** PATCH: any of the fields, plus opening or closing registration. */
export type EventChanges = Partial<Omit<EventInput, "publish" | "repeat">> & { registrationOpen?: boolean };
