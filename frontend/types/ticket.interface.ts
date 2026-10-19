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
