import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { ClubEvent, EventAttendee, EventChanges, EventInput, EventScope } from "@/types/event.interface";

// Everything about a club's events sits under one key, so any change can
// refresh all three lists (and the counts) at once.
export const eventsKey = (clubId: string) => ["clubs", clubId, "events"];

/** One of a club's event lists. Drafts only hold events you can edit. */
export const useClubEvents = (clubId: string | undefined, scope: EventScope, enabled = true) =>
  useApiQuery<ClubEvent[]>(
    [...eventsKey(clubId ?? ""), scope],
    { url: `/clubs/${clubId}/events`, params: { scope } },
    { enabled: !!clubId && enabled },
  );

/** One event, as you see it (the scanner's header and counts). */
export const useEvent = (clubId: string | undefined, eventId: string | undefined) =>
  useApiQuery<ClubEvent>(
    [...eventsKey(clubId ?? ""), "one", eventId ?? ""],
    { url: `/clubs/${clubId}/events/${eventId}` },
    { enabled: !!clubId && !!eventId },
  );

/** Who's going. Needs registration.view in the club. */
export const useEventAttendees = (clubId: string, eventId: string | null, enabled: boolean) =>
  useApiQuery<EventAttendee[]>(
    [...eventsKey(clubId), "attendees", eventId ?? ""],
    { url: `/clubs/${clubId}/events/${eventId}/registrations` },
    { enabled: !!eventId && enabled },
  );

/**
 * Event changes also refresh the clubs list: its upcoming counts move when
 * an event is published or created.
 */
const refreshes = (clubId: string, orgId: string) => [eventsKey(clubId), ["orgs", orgId, "clubs"]];

/** Creates a draft, or publishes straight away with `publish: true` (needs event.publish). */
export const useCreateEvent = (clubId: string, orgId: string) =>
  useApiMutation<ClubEvent, EventInput>(
    { method: "post", url: `/clubs/${clubId}/events` },
    { invalidates: refreshes(clubId, orgId) },
  );

/**
 * Edits an event you can manage, or opens/closes registration. Fails with
 * CAPACITY_BELOW_REGISTERED if capacity < registrations, EVENT_CANCELLED once cancelled.
 * A new time or place is emailed to everyone registered.
 */
export const useUpdateEvent = (clubId: string, orgId: string) =>
  useApiMutation<ClubEvent, { eventId: string } & EventChanges>(
    ({ eventId, ...changes }) => ({ method: "patch", url: `/clubs/${clubId}/events/${eventId}`, data: changes }),
    { invalidates: refreshes(clubId, orgId) },
  );

export const usePublishEvent = (clubId: string, orgId: string) =>
  useApiMutation<ClubEvent, { eventId: string }>(
    ({ eventId }) => ({ method: "post", url: `/clubs/${clubId}/events/${eventId}/publish` }),
    { invalidates: refreshes(clubId, orgId) },
  );

/** Calls off a published event; everyone registered is emailed, with the reason if given. */
export const useCancelEvent = (clubId: string, orgId: string) =>
  useApiMutation<ClubEvent, { eventId: string; reason?: string }>(
    ({ eventId, reason }) => ({ method: "post", url: `/clubs/${clubId}/events/${eventId}/cancel`, data: { reason } }),
    { invalidates: [...refreshes(clubId, orgId), ["me", "tickets"]] },
  );

/** Deletes a draft. Published events are cancelled instead (EVENT_NOT_DRAFT). */
export const useDeleteEvent = (clubId: string, orgId: string) =>
  useApiMutation<void, { eventId: string }>(
    ({ eventId }) => ({ method: "delete", url: `/clubs/${clubId}/events/${eventId}` }),
    { invalidates: refreshes(clubId, orgId) },
  );

/** Takes a place. Fails with EVENT_FULL, EVENT_ENDED, EVENT_NOT_OPEN, REGISTRATION_CLOSED or ALREADY_REGISTERED. */
export const useRegister = (clubId: string) =>
  useApiMutation<{ id: string }, { eventId: string }>(
    ({ eventId }) => ({ method: "post", url: `/clubs/${clubId}/events/${eventId}/my-registration` }),
    { invalidates: [eventsKey(clubId)] },
  );

/** Joins a full event's waitlist; your position comes back. PLACES_AVAILABLE if you could just register. */
export const useJoinWaitlist = (clubId: string) =>
  useApiMutation<{ position: number }, { eventId: string }>(
    ({ eventId }) => ({ method: "post", url: `/clubs/${clubId}/events/${eventId}/waitlist` }),
    { invalidates: [eventsKey(clubId)] },
  );

export const useLeaveWaitlist = (clubId: string) =>
  useApiMutation<void, { eventId: string }>(
    ({ eventId }) => ({ method: "delete", url: `/clubs/${clubId}/events/${eventId}/waitlist` }),
    { invalidates: [eventsKey(clubId)] },
  );

/** Gives your place back. Fails with ALREADY_CHECKED_IN once you've been scanned in. */
export const useCancelRegistration = (clubId: string) =>
  useApiMutation<void, { eventId: string }>(
    ({ eventId }) => ({ method: "delete", url: `/clubs/${clubId}/events/${eventId}/my-registration` }),
    { invalidates: [eventsKey(clubId)] },
  );
