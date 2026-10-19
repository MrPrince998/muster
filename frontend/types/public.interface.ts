/** GET /public/events/:eventId: a public event, as anyone with the link sees it. */
export interface PublicEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: "published" | "cancelled";
  cancelReason: string | null;
  ended: boolean;
  // false: registration closed early (the event still runs)
  registrationOpen: boolean;
  // null: no limit; 0 while anyone is waiting
  placesLeft: number | null;
  waitlistCount: number;
  clubName: string;
  workspaceName: string;
  // the zone its times are meant in (IANA name)
  timeZone: string;
}

export interface GuestPlaceInput {
  name: string;
  email: string;
}

/** POST .../places/confirm: a ticket, or (the event being full) a place in the queue. */
export type GuestPlaceResult = { ticketToken: string } | { waitlistPosition: number };
