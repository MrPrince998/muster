/** GET /me/tickets: a ticket you hold (no code; open it for that). */
export interface Ticket {
  registrationId: string;
  eventId: string;
  clubId: string;
  clubName: string;
  workspaceName: string;
  workspaceSlug: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  // the event was called off: the ticket gets nobody in
  eventCancelled: boolean;
  attendeeName: string;
  // the event's workspace's zone: its times are shown in it
  timeZone: string;
  // scanned at the door
  checkedInAt: string | null;
}

/** GET .../my-ticket: one ticket with what the door needs. */
export interface TicketWithCode extends Ticket {
  // the signed ticket the QR code holds
  token: string;
  // the QR code as SVG markup, drawn by the API
  qrSvg: string;
}

export type CheckInOutcome = "checked_in" | "already_checked_in" | "cancelled" | "wrong_event" | "invalid";

/** POST .../check-in: what the door should do, and the running count. */
export interface CheckInResult {
  outcome: CheckInOutcome;
  attendeeName?: string;
  checkedInAt?: string;
  checkedInByName?: string | null;
  attendedCount: number;
  registeredCount: number;
}

/** GET .../check-in/roster: one ticket on the door's list. */
export interface DoorTicket {
  registrationId: string;
  userId: string;
  name: string;
  checkedInAt: string | null;
  // they gave their place back
  cancelled: boolean;
}

/** The door's list, kept on the scanner for checking tickets with no connection. */
export interface DoorRoster {
  eventId: string;
  generatedAt: string;
  tickets: DoorTicket[];
}

/** POST .../check-in/sync: what happened to each check-in made offline. */
export interface SyncResult {
  results: {
    registrationId: string;
    outcome: "checked_in" | "already_checked_in" | "cancelled" | "invalid";
    attendeeName?: string;
    checkedInAt?: string;
    checkedInByName?: string | null;
  }[];
  attendedCount: number;
  registeredCount: number;
}
