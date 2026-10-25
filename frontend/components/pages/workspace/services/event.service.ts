import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { Answers, AttendeesPage, ClubEvent, DiscountCode, EventAttendee, EventChanges, EventInput, EventScope, PastEventsPage, SeriesScope } from "@/types/event.interface";

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

/** The club's past events, latest first, 20 at a time: the one list that never stops growing. */
export const useClubPastEvents = (clubId: string | undefined) =>
  useInfiniteQuery({
    queryKey: [...eventsKey(clubId ?? ""), "past"],
    queryFn: ({ pageParam, signal }) =>
      request<PastEventsPage>({
        url: `/clubs/${clubId}/events/past`,
        params: { ...(pageParam && { before: pageParam }), limit: 20 },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: !!clubId,
  });

/**
 * Everyone going, for the door: checking people in by name needs the whole
 * list, so this follows every page (100 at a time) into one.
 */
export const useDoorAttendees = (clubId: string, eventId: string, enabled: boolean) =>
  useQuery({
    queryKey: [...eventsKey(clubId), "attendees", eventId, "all"],
    queryFn: async ({ signal }) => {
      const all: EventAttendee[] = [];
      let after: string | null = null;
      do {
        const page: AttendeesPage = await request<AttendeesPage>({
          url: `/clubs/${clubId}/events/${eventId}/registrations`,
          params: { limit: 100, ...(after && { after }) },
          signal,
        });
        all.push(...page.attendees);
        after = page.next;
      } while (after);
      return all;
    },
    enabled: !!clubId && !!eventId && enabled,
  });

/** One event, as you see it (the scanner's header and counts). */
export const useEvent = (clubId: string | undefined, eventId: string | undefined) =>
  useApiQuery<ClubEvent>(
    [...eventsKey(clubId ?? ""), "one", eventId ?? ""],
    { url: `/clubs/${clubId}/events/${eventId}` },
    { enabled: !!clubId && !!eventId },
  );

/**
 * Who's going, in the order they registered: the first 8 (what the panel
 * shows), then 20 more at a time. Needs registration.view in the club.
 */
export const useEventAttendees = (clubId: string, eventId: string | null, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: [...eventsKey(clubId), "attendees", eventId ?? ""],
    queryFn: ({ pageParam, signal }) =>
      request<AttendeesPage>({
        url: `/clubs/${clubId}/events/${eventId}/registrations`,
        params: pageParam ? { after: pageParam, limit: 20 } : { limit: 8 },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: !!clubId && !!eventId && enabled,
  });

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
  useApiMutation<ClubEvent, { eventId: string; scope?: SeriesScope } & EventChanges>(
    ({ eventId, scope, ...changes }) => ({
      method: "patch",
      url: `/clubs/${clubId}/events/${eventId}`,
      params: { scope },
      data: changes,
    }),
    { invalidates: refreshes(clubId, orgId) },
  );

export const usePublishEvent = (clubId: string, orgId: string) =>
  useApiMutation<ClubEvent, { eventId: string; scope?: SeriesScope }>(
    ({ eventId, scope }) => ({ method: "post", url: `/clubs/${clubId}/events/${eventId}/publish`, params: { scope } }),
    { invalidates: refreshes(clubId, orgId) },
  );

/** Calls off a published event; everyone registered is emailed, with the reason if given. */
export const useCancelEvent = (clubId: string, orgId: string) =>
  useApiMutation<ClubEvent, { eventId: string; reason?: string; scope?: SeriesScope }>(
    ({ eventId, reason, scope }) => ({
      method: "post",
      url: `/clubs/${clubId}/events/${eventId}/cancel`,
      params: { scope },
      data: { reason },
    }),
    { invalidates: [...refreshes(clubId, orgId), ["me", "tickets"]] },
  );

/** Deletes a draft. Published events are cancelled instead (EVENT_NOT_DRAFT). */
export const useDeleteEvent = (clubId: string, orgId: string) =>
  useApiMutation<void, { eventId: string; scope?: SeriesScope }>(
    ({ eventId, scope }) => ({ method: "delete", url: `/clubs/${clubId}/events/${eventId}`, params: { scope } }),
    { invalidates: refreshes(clubId, orgId) },
  );

/** Takes a place. Fails with EVENT_FULL, EVENT_ENDED, EVENT_NOT_OPEN, REGISTRATION_CLOSED or ALREADY_REGISTERED. */
export const useRegister = (clubId: string) =>
  useApiMutation<{ id: string }, { eventId: string; answers?: Answers }>(
    ({ eventId, answers }) => ({ method: "post", url: `/clubs/${clubId}/events/${eventId}/my-registration`, data: { answers } }),
    { invalidates: [eventsKey(clubId)] },
  );

/** Joins a full event's waitlist; your position comes back. PLACES_AVAILABLE if you could just register. */
export const useJoinWaitlist = (clubId: string) =>
  useApiMutation<{ position: number }, { eventId: string; answers?: Answers; ticketTypeId?: string }>(
    ({ eventId, answers, ticketTypeId }) => ({
      method: "post",
      url: `/clubs/${clubId}/events/${eventId}/waitlist`,
      data: { answers, ticketTypeId },
    }),
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

/**
 * Saves the attendee list as a spreadsheet (CSV). Needs registration.view.
 * Fetched with your session (it's private), then handed to the browser to save.
 */
export async function downloadAttendees(clubId: string, eventId: string, title: string): Promise<void> {
  const blob = await request<Blob>({
    method: "get",
    url: `/clubs/${clubId}/events/${eventId}/registrations/export`,
    responseType: "blob",
  });
  saveFile(blob, `${fileSlug(title)}-attendees.csv`);
}

/** Saves the event as a calendar file (.ics), for any member who can see it. */
export async function downloadEventCalendar(clubId: string, eventId: string, title: string): Promise<void> {
  const blob = await request<Blob>({
    method: "get",
    url: `/clubs/${clubId}/events/${eventId}/calendar`,
    responseType: "blob",
  });
  saveFile(blob, `${fileSlug(title)}.ics`);
}

const fileSlug = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60) || "event";

// hands a fetched file to the browser to save
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** A message an organiser sent everyone going to an event. */
export interface EventMessage {
  id: string;
  subject: string;
  body: string;
  senderName: string;
  toWaitlist: boolean;
  recipientCount: number;
  sentAt: string;
}

const messagesKey = (clubId: string, eventId: string) => ["clubs", clubId, "events", eventId, "messages"];

/** What's been sent about an event, newest first (people who can edit it). */
export const useEventMessages = (clubId: string, eventId: string, enabled: boolean) =>
  useApiQuery<EventMessage[]>(messagesKey(clubId, eventId), { url: `/clubs/${clubId}/events/${eventId}/messages` }, { enabled });

/** Emails everyone going (and the waitlist, if asked). Ten a day per event (TOO_MANY_MESSAGES). */
export const useSendEventMessage = (clubId: string, eventId: string) =>
  useApiMutation<EventMessage, { subject: string; body: string; toWaitlist: boolean }>(
    { method: "post", url: `/clubs/${clubId}/events/${eventId}/messages` },
    { invalidates: [messagesKey(clubId, eventId)] },
  );

const codesKey = (clubId: string, eventId: string) => ["clubs", clubId, "events", eventId, "discount-codes"];

/** An event's discount codes, with their uses (people who can edit it). */
export const useDiscountCodes = (clubId: string, eventId: string, enabled: boolean) =>
  useApiQuery<DiscountCode[]>(codesKey(clubId, eventId), { url: `/clubs/${clubId}/events/${eventId}/discount-codes` }, { enabled });

/** A new code: a percentage or an amount off. CODE_TAKEN if the event has it already. */
export const useCreateDiscountCode = (clubId: string, eventId: string) =>
  useApiMutation<
    DiscountCode[],
    { code: string; percentOff?: number; amountOffCents?: number; maxUses?: number; expiresAt?: string }
  >({ method: "post", url: `/clubs/${clubId}/events/${eventId}/discount-codes` }, { invalidates: [codesKey(clubId, eventId)] });

/** Turns a code on or off. */
export const useSetDiscountCode = (clubId: string, eventId: string) =>
  useApiMutation<DiscountCode[], { codeId: string; active: boolean }>(
    ({ codeId, active }) => ({
      method: "patch",
      url: `/clubs/${clubId}/events/${eventId}/discount-codes/${codeId}`,
      data: { active },
    }),
    { invalidates: [codesKey(clubId, eventId)] },
  );

/** Puts a cover image on an event: the (resized) image itself, 2 MB at most. */
export const uploadCover = (clubId: string, eventId: string, image: Blob) =>
  request<ClubEvent>({
    method: "put",
    url: `/clubs/${clubId}/events/${eventId}/cover`,
    data: image,
    headers: { "Content-Type": image.type },
  });

/** Takes an event's cover image off. */
export const removeCover = (clubId: string, eventId: string) =>
  request<ClubEvent>({ method: "delete", url: `/clubs/${clubId}/events/${eventId}/cover` });
