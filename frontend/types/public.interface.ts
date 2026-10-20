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
  // a ticket's price; null: free
  price: { amountCents: number; currency: string } | null;
  // what people taking a place are asked
  questions: import("./event.interface").Question[];
  // the tickets on offer to the public; none: free
  ticketTypes: import("./event.interface").TicketType[];
  // discount codes work for this event
  hasCodes: boolean;
  // its cover image, a path on the API; null for none
  coverUrl: string | null;
}

export interface GuestPlaceInput {
  name: string;
  email: string;
  answers?: Record<string, string>;
  ticketTypeId?: string;
  code?: string;
}

/** POST .../places/confirm: a ticket, or (the event being full) a place in the queue. */
export type GuestPlaceResult = { ticketToken: string } | { waitlistPosition: number } | { checkoutUrl: string };
