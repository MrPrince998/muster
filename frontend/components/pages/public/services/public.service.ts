import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { GuestPlaceInput, PublicEvent, TicketWithCode } from "@/types";

const eventKey = (eventId: string) => ["public", "events", eventId];
const ticketKey = (token: string) => ["public", "tickets", token];

/** A public event's page. 404 (EVENT_NOT_FOUND) for drafts and members-only events. */
export const usePublicEvent = (eventId: string) =>
  useApiQuery<PublicEvent>(eventKey(eventId), { url: `/public/events/${eventId}` }, { retry: false });

/** Asks for a place: emails a link to confirm it. EVENT_FULL, REGISTRATION_CLOSED, EVENT_ENDED, EVENT_NOT_OPEN. */
export const useRequestPlace = (eventId: string) =>
  useApiMutation<void, GuestPlaceInput>(
    { method: "post", url: `/public/events/${eventId}/places` },
    { invalidates: [eventKey(eventId)] },
  );

/** Uses the emailed link: takes the place and returns the ticket's token. INVALID_TOKEN for a bad or old link. */
export const useConfirmPlace = (eventId: string) =>
  useApiMutation<{ ticketToken: string }, { token: string }>(
    { method: "post", url: `/public/events/${eventId}/places/confirm` },
    { invalidates: [eventKey(eventId)] },
  );

/** A ticket opened by its own token (a guest's way back to it). TICKET_NOT_FOUND once given back. */
export const useGuestTicket = (token: string) =>
  useApiQuery<TicketWithCode>(ticketKey(token), { url: `/public/tickets/${encodeURIComponent(token)}` }, { retry: false });

export const useCancelGuestTicket = (token: string) =>
  useApiMutation<void, void>(
    { method: "post", url: `/public/tickets/${encodeURIComponent(token)}/cancel` },
    { invalidates: [ticketKey(token)] },
  );
