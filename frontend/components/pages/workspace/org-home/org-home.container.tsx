"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { asApiError } from "@/lib/api/client";
import { startCheckout } from "../services/payment.service";
import type { ClubEvent } from "@/types/event.interface";
import { useWorkspace } from "../org-shell/workspace-context";
import {
  useCancelEvent,
  useCancelRegistration,
  useClubEvents,
  useDeleteEvent,
  useEventAttendees,
  useJoinWaitlist,
  useLeaveWaitlist,
  usePublishEvent,
  useRegister,
  useUpdateEvent,
} from "../services/event.service";
import OrgHomeView, { type EventTab } from "./org-home.view";
import type { PanelAction } from "./parts/event-panel";

/** What each refusal means for the person, in the panel. */
function actionMessage(code: string): string {
  switch (code) {
    case "EVENT_FULL":
      return "Someone took the last place just before you. The event is full now.";
    case "SOLD_OUT":
      return "Sold out: every ticket has gone.";
    case "PAYMENTS_NOT_SET_UP":
      return "Tickets aren't on sale right now: the organisers can't take payments.";
    case "PAYMENTS_UNAVAILABLE":
      return "Payments aren't available right now. Try again later.";
    case "EVENT_ENDED":
      return "This event has already ended.";
    case "EVENT_NOT_OPEN":
      return "This event isn't open for registration.";
    case "ALREADY_REGISTERED":
      return "You're already registered.";
    case "ALREADY_CHECKED_IN":
      return "You've already been checked in, so your place can't be cancelled.";
    case "REGISTRATION_NOT_FOUND":
      return "You weren't registered for this event.";
    case "EVENT_NOT_DRAFT":
      return "This event is already published. Cancel it instead.";
    case "PLACES_AVAILABLE":
      return "A place has just opened up: register instead.";
    case "NOT_WAITLISTED":
      return "You weren't on the waitlist.";
    case "REGISTRATION_CLOSED":
      return "Registration for this event has just closed.";
    case "EVENT_ALREADY_CANCELLED":
    case "EVENT_CANCELLED":
      return "This event has been cancelled.";
    case "EVENT_IS_DRAFT":
      return "Drafts are deleted, not cancelled.";
    case "MISSING_PERMISSION":
      return "You don't have permission to do that in this club.";
    case "NETWORK_ERROR":
      return "Can't reach Muster. Check your connection, then try again.";
    default:
      return "Something went wrong on our side. Try again in a moment.";
  }
}

/**
 * /o/[slug]: the workspace you opened, its clubs (with your permissions in
 * each), the chosen club's events, and the one you open. Owns selection and
 * actions; the view only renders.
 */
export default function OrgHomeContainer() {
  const { organisation, clubs } = useWorkspace();
  const orgId = organisation.orgId;
  // the club lives in the URL (?club=), so a reload or a shared link keeps it;
  // without one, the default club (listed first)
  const searchParams = useSearchParams();
  const clubParam = searchParams.get("club");
  // ?event= opens that event (from search, or a link in an email)
  const eventParam = searchParams.get("event");
  // back from Stripe's checkout: ?paid=1 (paid) or ?paid=0 (gave up)
  const paidParam = searchParams.get("paid");
  const router = useRouter();
  const pathname = usePathname();
  const club = clubs.data.find((c) => c.id === clubParam) ?? clubs.data[0] ?? null;
  const has = (permission: string) => !!club?.permissions.includes(permission as never);
  const canSeeDrafts = has("event.manage_own") || has("event.manage_any");

  const [tab, setTab] = useState<EventTab>("upcoming");
  const upcoming = useClubEvents(club?.id, "upcoming");
  const past = useClubEvents(club?.id, "past");
  const drafts = useClubEvents(club?.id, "drafts", canSeeDrafts);

  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const allEvents = [...(upcoming.data ?? []), ...(past.data ?? []), ...(drafts.data ?? [])];
  const openEvent = allEvents.find((event) => event.id === openEventId) ?? null;
  const attendees = useEventAttendees(
    club?.id ?? "",
    openEventId,
    has("registration.view") && openEvent?.status !== "draft",
  );

  const [dialog, setDialog] = useState<"new-event" | "edit-event" | null>(null);
  const [pending, setPending] = useState<PanelAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const register = useRegister(club?.id ?? "");
  const cancel = useCancelRegistration(club?.id ?? "");
  const joinWaitlist = useJoinWaitlist(club?.id ?? "");
  const leaveWaitlist = useLeaveWaitlist(club?.id ?? "");
  const publish = usePublishEvent(club?.id ?? "", orgId ?? "");
  const update = useUpdateEvent(club?.id ?? "", orgId ?? "");
  const cancelEvent = useCancelEvent(club?.id ?? "", orgId ?? "");
  const deleteEvent = useDeleteEvent(club?.id ?? "", orgId ?? "");

  // for the confirm dialogs: they show the error themselves, null when it worked
  const attempt = async (work: () => Promise<unknown>): Promise<string | null> => {
    try {
      await work();
      return null;
    } catch (error) {
      return actionMessage(asApiError(error).code);
    }
  };

  // one action at a time from the panel; its errors show there
  const run = async (action: PanelAction, work: () => Promise<unknown>) => {
    setPending(action);
    setActionError(null);
    try {
      await work();
    } catch (error) {
      setActionError(actionMessage(asApiError(error).code));
    } finally {
      setPending(null);
    }
  };

  const openEventPanel = (id: string | null) => {
    setOpenEventId(id);
    setActionError(null);
  };

  // new club in the URL: start again on Upcoming with nothing open
  const [shownClubId, setShownClubId] = useState(club?.id);
  if (club?.id !== shownClubId) {
    setShownClubId(club?.id);
    setTab("upcoming");
    setOpenEventId(null);
    setActionError(null);
  }

  // a linked event: open it on whichever tab holds it, once the lists have loaded
  const [linkedEvent, setLinkedEvent] = useState<string | null>(null);
  if (!eventParam && linkedEvent !== null) setLinkedEvent(null);
  if (eventParam && eventParam !== linkedEvent && club?.id === shownClubId) {
    const holder = (["upcoming", "past", "drafts"] as const).find((list) =>
      ({ upcoming, past, drafts })[list].data?.some((event) => event.id === eventParam),
    );
    const settled = !upcoming.isPending && !past.isPending && (!canSeeDrafts || !drafts.isPending);
    if (holder || settled) {
      setLinkedEvent(eventParam);
      if (holder) {
        setTab(holder);
        setOpenEventId(eventParam);
        setActionError(null);
      }
    }
  }
  // the event a Stripe return was for: the linked one, remembered once the link is dropped
  const [paidEventId, setPaidEventId] = useState<string | null>(null);
  if (paidParam && eventParam && paidEventId !== eventParam) setPaidEventId(eventParam);
  // paid: Stripe tells the API in a moment; look again until the ticket's there (up to a minute)
  const awaitingTicket = paidParam === "1" && !!paidEventId && !!upcoming.data &&
    !upcoming.data.find((e) => e.id === paidEventId)?.youreGoing;
  useEffect(() => {
    if (!awaitingTicket) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 60_000) clearInterval(timer);
      void upcoming.refetch();
    }, 2000);
    return () => clearInterval(timer);
  }, [awaitingTicket, upcoming]);

  // the ticket's here: the Stripe return has done its job, so it leaves the address
  // (giving the ticket back later shows the event as it is, not "payment received")
  const ticketArrived = !!paidParam && !!paidEventId && !!upcoming.data?.find((e) => e.id === paidEventId)?.youreGoing;
  useEffect(() => {
    // while the event link is still there, the effect below drops both at once
    if (!ticketArrived || eventParam) return;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("paid");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [ticketArrived, eventParam, pathname, router, searchParams]);

  // then drop it from the address, so the same link works again later
  useEffect(() => {
    if (!eventParam || linkedEvent !== eventParam) return;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("event");
    if (ticketArrived) rest.delete("paid");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [eventParam, linkedEvent, pathname, router, searchParams, ticketArrived]);

  const lists: Record<EventTab, { data: ClubEvent[]; loading: boolean; failed: boolean }> = {
    upcoming: { data: upcoming.data ?? [], loading: upcoming.isPending, failed: upcoming.isError },
    past: { data: past.data ?? [], loading: past.isPending, failed: past.isError },
    drafts: { data: drafts.data ?? [], loading: canSeeDrafts && drafts.isPending, failed: drafts.isError },
  };

  return (
    <OrgHomeView
      organisation={organisation}
      clubs={clubs}
      club={club}
      can={{
        createEvents: has("event.create"),
        publishEvents: has("event.publish"),
        seeDrafts: canSeeDrafts,
        viewAttendees: has("registration.view"),
        scanTickets: has("checkin.scan"),
        manageClub: has("role.manage") || has("member.remove"),
        seeAttendance: has("analytics.view"),
      }}
      tab={tab}
      onTabChange={setTab}
      lists={lists}
      onRetryEvents={() => {
        upcoming.refetch();
        past.refetch();
        if (canSeeDrafts) drafts.refetch();
      }}
      openEvent={openEvent}
      onOpenEvent={openEventPanel}
      panel={{
        attendees: { list: attendees.data ?? [], loading: attendees.isPending && attendees.fetchStatus !== "idle", failed: attendees.isError },
        pending,
        error: actionError,
        onRegister: () => openEvent && run("register", () => register.mutateAsync({ eventId: openEvent.id })),
        onCancel: () => openEvent && run("cancel", () => cancel.mutateAsync({ eventId: openEvent.id })),
        onJoinWaitlist: () => openEvent && run("waitlist", () => joinWaitlist.mutateAsync({ eventId: openEvent.id })),
        onBuy: () =>
          openEvent &&
          run("buy", async () => {
            const { url } = await startCheckout(openEvent.clubId, openEvent.id);
            window.location.assign(url);
            // stays "going to checkout" while the browser leaves
            await new Promise(() => undefined);
          }),
        paymentReturn:
          openEvent && paidParam && openEvent.id === paidEventId && !openEvent.youreGoing
            ? paidParam === "1"
              ? "paid"
              : "cancelled"
            : null,
        onLeaveWaitlist: () =>
          openEvent && run("leave-waitlist", () => leaveWaitlist.mutateAsync({ eventId: openEvent.id })),
        onPublish: (scope) =>
          openEvent &&
          run(scope === "following" ? "publish-following" : "publish", async () => {
            await publish.mutateAsync({ eventId: openEvent.id, scope });
            setTab("upcoming");
          }),
        onEdit: () => setDialog("edit-event"),
        onToggleRegistration: () =>
          openEvent &&
          run("registration", () =>
            update.mutateAsync({ eventId: openEvent.id, registrationOpen: !openEvent.registrationOpen }),
          ),
        onCancelEvent: async (reason, scope) =>
          openEvent
            ? attempt(() =>
                cancelEvent.mutateAsync({ eventId: openEvent.id, reason: reason.trim() || undefined, scope }),
              )
            : null,
        onDeleteDraft: async (scope) =>
          openEvent
            ? attempt(async () => {
                await deleteEvent.mutateAsync({ eventId: openEvent.id, scope });
                openEventPanel(null);
              })
            : null,
      }}
      dialog={dialog}
      onDialogChange={setDialog}
      onEventSaved={(saved) => {
        setTab(saved.status === "draft" ? "drafts" : "upcoming");
        openEventPanel(saved.id);
      }}
    />
  );
}
