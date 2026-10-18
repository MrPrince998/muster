"use client";

import { CalendarDays, Clock, Globe, LoaderCircle, Lock, MapPin, Pencil, QrCode, ScanLine, X } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { ClubEvent, EventAttendee } from "@/types/event.interface";
import { TicketDialog } from "../../tickets/ticket-dialog";
import { formatFullDate, formatTimeRange } from "./format";

// The panel is a column beside the events from xl up, a sheet below that.
const WIDE = "(min-width: 80rem)";
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

export type PanelAction = "register" | "cancel" | "publish";

export interface EventPanelProps {
  event: ClubEvent | null;
  clubName: string;
  canPublish: boolean;
  canViewAttendees: boolean;
  // checkin.scan in this club, and where the scanner for this event lives
  canScan: boolean;
  scanHref: string;
  attendees: { list: EventAttendee[]; loading: boolean; failed: boolean };
  pending: PanelAction | null;
  error: string | null;
  onRegister: () => void;
  onCancel: () => void;
  onPublish: () => void;
  onEdit: () => void;
  onClose: () => void;
}

/** The event you picked: details, then what you can do with it. */
export function EventPanel(props: EventPanelProps) {
  const wide = useWide();
  const { event, onClose } = props;

  if (wide) {
    if (!event) return null;
    return (
      <aside
        aria-label={event.title}
        className="sticky top-14 h-[calc(100svh-3.5rem)] w-[22rem] shrink-0 overflow-y-auto border-l bg-background"
      >
        <PanelBody {...props} event={event} />
      </aside>
    );
  }

  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md" showCloseButton={false}>
        {event && <PanelBody {...props} event={event} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody(props: EventPanelProps & { event: ClubEvent }) {
  const { event, clubName, error, onClose } = props;
  const ended = new Date(event.endsAt) <= new Date();
  const draft = event.status === "draft";
  const full = event.capacity !== null && event.registeredCount >= event.capacity;
  const left = event.capacity === null ? null : Math.max(0, event.capacity - event.registeredCount);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-cobalt">{draft ? `${clubName}, draft` : clubName}</p>
          <SheetTitleOrHeading>{event.title}</SheetTitleOrHeading>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close event details">
          <X aria-hidden />
        </Button>
      </div>

      <dl className="space-y-2.5 text-sm">
        <Detail icon={CalendarDays} label="Date">
          {formatFullDate(event.startsAt)}
        </Detail>
        <Detail icon={Clock} label="Time">
          {formatTimeRange(event.startsAt, event.endsAt)}
        </Detail>
        {event.location && (
          <Detail icon={MapPin} label="Place">
            {event.location}
          </Detail>
        )}
        <Detail icon={event.visibility === "public" ? Globe : Lock} label="Who can come">
          {event.visibility === "public" ? "Anyone with the link, guests included" : `${clubName} members only`}
        </Detail>
      </dl>

      {event.description && <p className="text-sm whitespace-pre-line">{event.description}</p>}

      {/* how full: the number organisers and members both look for first */}
      {!draft && (
        <section aria-label="Places" className="rounded-xl bg-muted/60 p-4">
          {ended ? (
            <>
              <p className="text-3xl leading-none font-extrabold font-stretch-70%">{event.attendedCount} came</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {event.registeredCount > 0
                  ? `${Math.round((event.attendedCount / event.registeredCount) * 100)}% of ${event.registeredCount} who registered`
                  : "Nobody registered"}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl leading-none font-extrabold font-stretch-70%">
                {event.registeredCount}{" "}
                <span className="text-muted-foreground">
                  {event.capacity === null ? "going" : `of ${event.capacity}`}
                </span>
              </p>
              <p className={cn("mt-1 text-sm", full ? "font-semibold text-stamp" : "text-muted-foreground")}>
                {left === null ? "No limit on places" : full ? "Full. No places left." : `${left} ${left === 1 ? "place" : "places"} left`}
              </p>
            </>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {props.canScan && !draft && !ended && (
        <Link href={props.scanHref} className={cn(buttonVariants({ size: "lg" }), "h-11 font-semibold")}>
          <ScanLine aria-hidden />
          Open check-in
        </Link>
      )}
      {event.canManage && <OrganiserActions {...props} draft={draft} />}
      {!draft && <MemberActions {...props} ended={ended} full={full} />}
      {props.canViewAttendees && !draft && <WhosGoing {...props} ended={ended} />}
    </div>
  );
}

// Inside the sheet the heading must be the dialog's title for screen readers.
function SheetTitleOrHeading({ children }: { children: React.ReactNode }) {
  const wide = useWide();
  const className = "mt-0.5 text-3xl leading-none font-extrabold font-stretch-70%";
  if (wide) return <h2 className={className}>{children}</h2>;
  return (
    <>
      <SheetTitle className={cn(className, "text-foreground")}>{children}</SheetTitle>
      <SheetDescription className="sr-only">Event details</SheetDescription>
    </>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const Spinner = () => <LoaderCircle className="animate-spin" aria-hidden />;

function OrganiserActions({
  canPublish,
  pending,
  onPublish,
  onEdit,
  draft,
}: EventPanelProps & { draft: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {draft && canPublish && (
        <Button size="lg" className="h-11 font-semibold" onClick={onPublish} disabled={pending === "publish"}>
          {pending === "publish" && <Spinner />}
          {pending === "publish" ? "Publishing…" : "Publish event"}
        </Button>
      )}
      {draft && !canPublish && (
        <p className="text-sm text-muted-foreground">Someone who can publish events in this club needs to publish it.</p>
      )}
      <Button size="lg" variant="outline" className="h-11" onClick={onEdit}>
        <Pencil aria-hidden />
        Edit event
      </Button>
    </div>
  );
}

function MemberActions({
  event,
  pending,
  onRegister,
  onCancel,
  ended,
  full,
}: EventPanelProps & { event: ClubEvent; ended: boolean; full: boolean }) {
  const [showingTicket, setShowingTicket] = useState(false);

  if (ended) {
    return (
      <p className="text-sm text-muted-foreground">
        {event.youreGoing ? "You were registered for this one." : "This event has ended."}
      </p>
    );
  }

  if (event.youreGoing) {
    return (
      <div className="flex flex-col gap-2">
        <p className="rounded-xl bg-cobalt-50 p-4 text-sm text-cobalt-800">
          <span className="font-semibold">You&rsquo;re going.</span> Show your ticket at the door to get in.
        </p>
        <Button
          size="lg"
          variant={event.canManage ? "outline" : "default"}
          className="h-11 font-semibold"
          onClick={() => setShowingTicket(true)}
        >
          <QrCode aria-hidden />
          Show my ticket
        </Button>
        <TicketDialog clubId={event.clubId} eventId={event.id} open={showingTicket} onOpenChange={setShowingTicket} />
        <Button
          size="lg"
          variant="ghost"
          className="h-11 text-muted-foreground"
          onClick={onCancel}
          disabled={pending === "cancel"}
        >
          {pending === "cancel" && <Spinner />}
          {pending === "cancel" ? "Cancelling…" : "Cancel my place"}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="lg"
      variant={event.canManage ? "outline" : "default"}
      className="h-11 font-semibold"
      disabled={full || pending === "register"}
      onClick={onRegister}
    >
      {pending === "register" && <Spinner />}
      {full ? "No places left" : pending === "register" ? "Registering…" : "Register"}
    </Button>
  );
}

function WhosGoing({ event, attendees, ended }: EventPanelProps & { event: ClubEvent; ended: boolean }) {
  const shown = attendees.list.slice(0, 8);
  const more = attendees.list.length - shown.length;

  return (
    <section aria-labelledby="whos-going">
      <h3 id="whos-going" className="text-sm font-semibold">
        {ended ? "Who registered" : "Who's going"}
        <span className="ml-1.5 font-normal text-muted-foreground">{event.registeredCount}</span>
      </h3>
      {attendees.loading ? (
        <div className="mt-3 space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-7 w-40 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          ))}
        </div>
      ) : attendees.failed ? (
        <p className="mt-2 text-sm text-muted-foreground">Couldn&rsquo;t load the list. Close and reopen the event to try again.</p>
      ) : shown.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nobody yet. Share the event to get people in.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {shown.map((person) => (
            <li key={person.userId} className="flex items-center gap-2.5 text-sm">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-cobalt-50 text-[11px] font-semibold text-cobalt-800">
                {person.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("")}
              </span>
              <span className="truncate">{person.name}</span>
              {person.checkedInAt && <span className="ml-auto text-xs text-muted-foreground">checked in</span>}
            </li>
          ))}
          {more > 0 && <li className="pl-9.5 text-sm text-muted-foreground">and {more} more</li>}
        </ul>
      )}
    </section>
  );
}
