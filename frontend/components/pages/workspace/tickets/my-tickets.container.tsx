"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Ticket } from "@/types/ticket.interface";
import { formatTime, stubParts } from "../org-home/parts/format";
import { useMyTickets } from "../services/ticket.service";
import { TicketDialog } from "./ticket-dialog";

/**
 * /tickets: every ticket you hold, soonest first. A ticket email links to
 * /tickets?ticket={registration id}, which opens that ticket straight away.
 */
export default function MyTicketsContainer() {
  const router = useRouter();
  const tickets = useMyTickets();
  const [open, setOpen] = useState<Ticket | null>(null);
  // the ticket the link asked for. useSearchParams, not window.location: right
  // after signing in, Next renders this page before the address bar changes.
  const ticketParam = useSearchParams().get("ticket");
  const [dismissed, setDismissed] = useState(false);
  const requestedId = dismissed ? null : ticketParam;
  const list = tickets.data ?? [];
  const requested = requestedId ? list.find((ticket) => ticket.registrationId === requestedId) : undefined;
  // asked for, but not among your current tickets (ended, or you gave the place back)
  const requestedMissing = !!requestedId && tickets.isSuccess && !requested;
  const shown = open ?? requested ?? null;

  const close = () => {
    setOpen(null);
    if (requestedId) {
      setDismissed(true);
      // so a reload doesn't open it again
      router.replace("/tickets", { scroll: false });
    }
  };

  return (
    <section className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">My tickets</h1>
      <p className="mt-2 text-muted-foreground">Show the QR code at the door. Each ticket gets you in once.</p>

      {requestedMissing && (
        <p role="status" className="mt-6 rounded-xl bg-muted/70 p-4 text-sm">
          The ticket from that link isn&rsquo;t among your current tickets. The event may have ended, or the place
          was given back. Your other tickets are below.
        </p>
      )}

      <div className="mt-8">
        {tickets.isPending ? (
          <ul className="space-y-3" aria-hidden>
            {[0, 1].map((i) => (
              <li key={i} className="h-24 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
            ))}
          </ul>
        ) : tickets.isError ? (
          <div className="rounded-xl border border-dashed p-8">
            <p className="text-xl font-bold font-stretch-80%">Couldn&rsquo;t load your tickets</p>
            <p className="mt-1 text-muted-foreground">Check your connection, then try again.</p>
            <Button className="mt-4" variant="outline" onClick={() => tickets.refetch()}>
              Try again
            </Button>
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8">
            <p className="text-xl font-bold font-stretch-80%">No tickets yet</p>
            <p className="mt-1 text-muted-foreground">Register for an event and its ticket shows up here.</p>
            <Link href="/workspaces" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
              Find events in your workspaces
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {list.map((ticket) => (
              <li key={ticket.registrationId}>
                <TicketRow ticket={ticket} onOpen={() => setOpen(ticket)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {shown && (
        <TicketDialog
          key={shown.registrationId}
          clubId={shown.clubId}
          eventId={shown.eventId}
          open
          onOpenChange={(next) => !next && close()}
        />
      )}
    </section>
  );
}

// the same notched ticket as the club's events
const notches = [
  "radial-gradient(circle 0.55rem at var(--tear) 0, transparent 98%, #000) top / 100% 51% no-repeat",
  "radial-gradient(circle 0.55rem at var(--tear) 100%, transparent 98%, #000) bottom / 100% 51% no-repeat",
].join(", ");

function TicketRow({ ticket, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const { day, month, weekday } = stubParts(ticket.startsAt, ticket.timeZone);
  return (
    <button type="button" onClick={onOpen} className="group block w-full text-left focus-visible:outline-none">
      <div
        style={{ mask: notches, WebkitMask: notches }}
        className="grid grid-cols-[var(--tear)_1fr] rounded-xl bg-background inset-ring inset-ring-border transition-colors [--tear:5.25rem] group-hover:bg-cobalt-50/60 group-focus-visible:inset-ring-3 group-focus-visible:inset-ring-ring sm:[--tear:6.5rem]"
      >
        <div
          className={cn(
            "flex flex-col items-center justify-center border-r-2 border-dashed border-border px-2 py-4",
            ticket.eventCancelled ? "text-muted-foreground" : "text-cobalt",
          )}
        >
          <span className="text-4xl leading-none font-extrabold font-stretch-70%">{day}</span>
          <span className="mt-1 text-sm font-semibold">{month}</span>
          <span className="text-xs text-muted-foreground">{weekday}</span>
        </div>
        <div className="min-w-0 p-4">
          <p className="truncate text-lg leading-tight font-bold font-stretch-80%">{ticket.eventTitle}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {formatTime(ticket.startsAt, ticket.timeZone)}
            {ticket.location ? `, ${ticket.location}` : ""}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {ticket.clubName}, {ticket.workspaceName}
          </p>
          {(ticket.checkedInAt || ticket.eventCancelled) && (
            <span
              className={cn(
                "mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold",
                ticket.eventCancelled ? "bg-destructive/10 text-destructive" : "bg-cobalt-50 text-cobalt-800",
              )}
            >
              {ticket.eventCancelled ? "Event cancelled" : `Checked in at ${formatTime(ticket.checkedInAt!, ticket.timeZone)}`}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
