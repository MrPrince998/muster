import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { CheckInResult, Ticket, TicketWithCode } from "@/types/ticket.interface";
import { eventsKey } from "./event.service";

/** Your tickets everywhere, soonest first (events that haven't ended). */
export const useMyTickets = () => useApiQuery<Ticket[]>(["me", "tickets"], { url: "/me/tickets" });

/** Your ticket for one event, with its signed code and QR. */
export const useMyTicket = (clubId: string | undefined, eventId: string | undefined) =>
  useApiQuery<TicketWithCode>(
    ["clubs", clubId ?? "", "events", eventId ?? "", "my-ticket"],
    { url: `/clubs/${clubId}/events/${eventId}/my-ticket` },
    // a fresh check-in should show up when they reopen it
    { enabled: !!clubId && !!eventId, staleTime: 0 },
  );

// a check-in changes the counts and the attendee list
const afterCheckIn = (clubId: string) => [eventsKey(clubId)];

/**
 * Checks in what the scanner read. Always answers with an outcome (checked
 * in, already used, cancelled, wrong event, invalid); needs checkin.scan.
 */
export const useCheckIn = (clubId: string, eventId: string) =>
  useApiMutation<CheckInResult, { token: string }>(
    { method: "post", url: `/clubs/${clubId}/events/${eventId}/check-in` },
    { invalidates: afterCheckIn(clubId) },
  );

/** Checks someone in by name, when their ticket can't be scanned. */
export const useManualCheckIn = (clubId: string, eventId: string) =>
  useApiMutation<CheckInResult, { userId: string }>(
    { method: "post", url: `/clubs/${clubId}/events/${eventId}/check-in/manual` },
    { invalidates: afterCheckIn(clubId) },
  );
