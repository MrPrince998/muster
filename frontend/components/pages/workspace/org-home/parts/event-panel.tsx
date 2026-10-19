"use client";

import {
  CalendarDays,
  Check,
  Clock,
  DoorClosed,
  Download,
  DoorOpen,
  Globe,
  Link2,
  LoaderCircle,
  Lock,
  MapPin,
  Pencil,
  QrCode,
  Repeat,
  ScanLine,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ClubEvent, EventAttendee, SeriesScope } from "@/types/event.interface";
import { downloadAttendees, eventsKey } from "../../services/event.service";
import { ConfirmDialog } from "../../shared/confirm-dialog";
import { hasLaterInSeries, SeriesScopeChoice, seriesLabel } from "../../shared/series-scope-choice";
import { TicketDialog } from "../../tickets/ticket-dialog";
import { differsFromDevice, zoneCity, zoneName } from "@/lib/time-zone";
import { FeedbackSection } from "./feedback-section";
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

export type PanelAction =
  | "register"
  | "cancel"
  | "publish"
  | "publish-following"
  | "registration"
  | "waitlist"
  | "leave-waitlist";

export interface EventPanelProps {
  event: ClubEvent | null;
  // the workspace's zone: times are shown in it
  timeZone?: string;
  clubName: string;
  canPublish: boolean;
  canViewAttendees: boolean;
  // analytics.view: how past events were rated
  canSeeFeedback: boolean;
  // checkin.scan in this club, and where the scanner for this event lives
  canScan: boolean;
  scanHref: string;
  attendees: { list: EventAttendee[]; loading: boolean; failed: boolean };
  pending: PanelAction | null;
  error: string | null;
  onRegister: () => void;
  onCancel: () => void;
  onJoinWaitlist: () => void;
  onLeaveWaitlist: () => void;
  // with "following", the later drafts of its series too
  onPublish: (scope?: SeriesScope) => void;
  onEdit: () => void;
  // open or close registration
  onToggleRegistration: () => void;
  // these confirm first; they resolve to an error message, or null when done
  onCancelEvent: (reason: string, scope: SeriesScope) => Promise<string | null>;
  onDeleteDraft: (scope: SeriesScope) => Promise<string | null>;
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
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-md"
        showCloseButton={false}
      >
        {event && <PanelBody {...props} event={event} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody(props: EventPanelProps & { event: ClubEvent }) {
  const { event, clubName, error, onClose } = props;
  const ended = new Date(event.endsAt) <= new Date();
  const draft = event.status === "draft";
  const cancelled = event.status === "cancelled";
  const full =
    event.capacity !== null && event.registeredCount >= event.capacity;
  const left =
    event.capacity === null
      ? null
      : Math.max(0, event.capacity - event.registeredCount);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-cobalt">
            {draft
              ? `${clubName}, draft`
              : cancelled
                ? `${clubName}, cancelled`
                : clubName}
          </p>
          <SheetTitleOrHeading>{event.title}</SheetTitleOrHeading>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close event details"
        >
          <X aria-hidden />
        </Button>
      </div>

      <dl className="space-y-2.5 text-sm">
        <Detail icon={CalendarDays} label="Date">
          {formatFullDate(event.startsAt, props.timeZone)}
        </Detail>
        <Detail icon={Clock} label="Time">
          {formatTimeRange(event.startsAt, event.endsAt, props.timeZone)}
          {differsFromDevice(props.timeZone) && (
            <span className="block text-xs text-muted-foreground">
              {zoneCity(props.timeZone!)} time (
              {zoneName(event.startsAt, props.timeZone!)})
            </span>
          )}
        </Detail>
        {event.location && (
          <Detail icon={MapPin} label="Place">
            {event.location}
          </Detail>
        )}
        {event.series && (
          <Detail icon={Repeat} label="Repeats">
            {seriesLabel(event.series)}
          </Detail>
        )}
        <Detail
          icon={event.visibility === "public" ? Globe : Lock}
          label="Who can come"
        >
          {event.visibility === "public"
            ? "Anyone with the link, guests included"
            : `${clubName} members only`}
          {event.visibility === "public" && !draft && (
            <CopyPublicLink eventId={event.id} />
          )}
        </Detail>
      </dl>

      {event.description && (
        <p className="text-sm whitespace-pre-line">{event.description}</p>
      )}

      {/* how full: the number organisers and members both look for first */}
      {cancelled && <CancelledNotice event={event} timeZone={props.timeZone} />}
      {!draft && !cancelled && (
        <section aria-label="Places" className="rounded-xl bg-muted/60 p-4">
          {ended ? (
            <>
              <p className="text-3xl leading-none font-extrabold font-stretch-70%">
                {event.attendedCount} came
              </p>
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
              <p
                className={cn(
                  "mt-1 text-sm",
                  full ? "font-semibold text-stamp" : "text-muted-foreground",
                )}
              >
                {!event.registrationOpen
                  ? "Registration is closed."
                  : left === null
                    ? "No limit on places"
                    : full
                      ? event.waitlistCount > 0
                        ? `Full. ${event.waitlistCount} waiting for a place.`
                        : "Full. No places left."
                      : `${left} ${left === 1 ? "place" : "places"} left`}
              </p>
            </>
          )}
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {props.canScan && !draft && !cancelled && !ended && (
        <Link
          href={props.scanHref}
          className={cn(buttonVariants({ size: "lg" }), "h-11 font-semibold")}
        >
          <ScanLine aria-hidden />
          Open check-in
        </Link>
      )}
      {event.canManage && !cancelled && (
        <OrganiserActions {...props} draft={draft} ended={ended} />
      )}
      {!draft && !cancelled && (
        <MemberActions {...props} ended={ended} full={full} />
      )}
      {props.canSeeFeedback && ended && !cancelled && (
        <FeedbackSection clubId={event.clubId} eventId={event.id} />
      )}
      {props.canViewAttendees && !draft && (
        <WhosGoing {...props} ended={ended} />
      )}
    </div>
  );
}

// Inside the sheet the heading must be the dialog's title for screen readers.
function SheetTitleOrHeading({ children }: { children: React.ReactNode }) {
  const wide = useWide();
  const className =
    "mt-0.5 text-3xl leading-none font-extrabold font-stretch-70%";
  if (wide) return <h2 className={className}>{children}</h2>;
  return (
    <>
      <SheetTitle className={cn(className, "text-foreground")}>
        {children}
      </SheetTitle>
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
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The public page's address, for sharing a public event outside the club. */
function CopyPublicLink({ eventId }: { eventId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/e/${eventId}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard access: open the page instead, so the address is one copy away
      window.open(`/e/${eventId}`, "_blank", "noopener");
    }
  };
  return (
    <span className="mt-1 flex items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 font-medium text-cobalt underline-offset-4 hover:underline"
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Link2 className="size-3.5" aria-hidden />
        )}
        {copied ? "Link copied" : "Copy public link"}
      </button>
      <Link
        href={`/e/${eventId}`}
        target="_blank"
        className="text-muted-foreground underline-offset-4 hover:underline"
      >
        Open page
      </Link>
    </span>
  );
}

const Spinner = () => <LoaderCircle className="animate-spin" aria-hidden />;

function OrganiserActions({
  event,
  canPublish,
  pending,
  onPublish,
  onEdit,
  onToggleRegistration,
  onCancelEvent,
  onDeleteDraft,
  draft,
  ended,
}: EventPanelProps & { event: ClubEvent; draft: boolean; ended: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<"cancel" | "delete" | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<SeriesScope>("this");
  const series = hasLaterInSeries(event);
  const going = event.registeredCount;

  const confirm = (what: "cancel" | "delete") => {
    // the count in the dialog is who gets emailed: fetch it fresh, in case people registered since
    if (what === "cancel")
      void queryClient.invalidateQueries({ queryKey: eventsKey(event.clubId) });
    setScope("this");
    setConfirming(what);
  };

  return (
    <div className="flex flex-col gap-2">
      {draft && canPublish && series && (
        <Button
          size="lg"
          className="h-11 font-semibold"
          onClick={() => onPublish("following")}
          disabled={pending === "publish" || pending === "publish-following"}
        >
          {pending === "publish-following" && <Spinner />}
          {pending === "publish-following" ? "Publishing…" : "Publish this and following"}
        </Button>
      )}
      {draft && canPublish && (
        <Button
          size="lg"
          variant={series ? "outline" : "default"}
          className={cn("h-11", !series && "font-semibold")}
          onClick={() => onPublish()}
          disabled={pending === "publish" || pending === "publish-following"}
        >
          {pending === "publish" && <Spinner />}
          {pending === "publish" ? "Publishing…" : series ? "Publish only this one" : "Publish event"}
        </Button>
      )}
      {draft && !canPublish && (
        <p className="text-sm text-muted-foreground">
          Someone who can publish events in this club needs to publish it.
        </p>
      )}
      <Button size="lg" variant="outline" className="h-11" onClick={onEdit}>
        <Pencil aria-hidden />
        Edit event
      </Button>
      {!draft && !ended && (
        <Button
          size="lg"
          variant="outline"
          className="h-11"
          onClick={onToggleRegistration}
          disabled={pending === "registration"}
        >
          {pending === "registration" ? (
            <Spinner />
          ) : event.registrationOpen ? (
            <DoorClosed aria-hidden />
          ) : (
            <DoorOpen aria-hidden />
          )}
          {event.registrationOpen ? "Close registration" : "Open registration"}
        </Button>
      )}
      {(draft || !ended) && (
        <Button
          size="lg"
          variant="ghost"
          className="h-11 text-destructive hover:bg-destructive/5 hover:text-destructive"
          onClick={() => confirm(draft ? "delete" : "cancel")}
        >
          {draft ? "Delete draft" : "Cancel event"}
        </Button>
      )}

      <ConfirmDialog
        open={confirming === "cancel"}
        onOpenChange={(open) => {
          setConfirming(open ? "cancel" : null);
          if (!open) setReason("");
        }}
        title={`Cancel ${event.title}?`}
        body={
          scope === "following"
            ? "Everyone registered for any of them gets an email, and their tickets stop working at the door. They stay listed as cancelled."
            : going === 0
            ? "Nobody has registered yet. It stays listed as cancelled."
            : `${going} ${going === 1 ? "person has" : "people have"} registered. Each gets an email, and their tickets stop working at the door.`
        }
        confirmLabel="Cancel event"
        pendingLabel="Cancelling…"
        dismissLabel="Keep event"
        destructive
        onConfirm={() => onCancelEvent(reason, scope)}
      >
        {series && <SeriesScopeChoice value={scope} onChange={setScope} verb="cancel" name="cancel-scope" />}
        {(going > 0 || scope === "following") && (
          <div className="space-y-1.5">
            <label htmlFor="cancel-reason" className="text-sm font-medium">
              Note for them{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Textarea
              id="cancel-reason"
              value={reason}
              maxLength={500}
              rows={3}
              placeholder="The speaker is ill. We'll post a new date soon."
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === "delete"}
        onOpenChange={(open) => setConfirming(open ? "delete" : null)}
        title={`Delete ${event.title}?`}
        body={
          scope === "following"
            ? "These drafts are gone for good. Nobody else has seen them; published ones in the series stay."
            : "The draft is gone for good. Nobody else has seen it."
        }
        confirmLabel="Delete draft"
        pendingLabel="Deleting…"
        dismissLabel="Keep draft"
        destructive
        onConfirm={() => onDeleteDraft(scope)}
      >
        {series && <SeriesScopeChoice value={scope} onChange={setScope} verb="delete" name="delete-scope" />}
      </ConfirmDialog>
    </div>
  );
}

/** A cancelled event's stamp, the organisers' note, and what it means for you. */
function CancelledNotice({
  event,
  timeZone,
}: {
  event: ClubEvent;
  timeZone?: string;
}) {
  return (
    <section aria-label="Cancelled" className="rounded-xl bg-destructive/5 p-4">
      <p className="inline-block -rotate-3 rounded-lg border-[3px] border-stamp px-3 py-1 text-2xl leading-none font-extrabold text-stamp font-stretch-70%">
        Cancelled
      </p>
      {event.cancelledAt && (
        <p className="mt-3 text-sm text-muted-foreground">
          on {formatFullDate(event.cancelledAt, timeZone)}
        </p>
      )}
      {event.cancelReason && (
        <p className="mt-2 text-sm whitespace-pre-line">
          &ldquo;{event.cancelReason}&rdquo;
        </p>
      )}
      {event.youreGoing && (
        <p className="mt-2 text-sm">
          You were registered. There&rsquo;s nothing to do: your ticket
          won&rsquo;t be needed.
        </p>
      )}
    </section>
  );
}

function MemberActions({
  event,
  pending,
  onRegister,
  onCancel,
  onJoinWaitlist,
  onLeaveWaitlist,
  ended,
  full,
}: EventPanelProps & { event: ClubEvent; ended: boolean; full: boolean }) {
  const [showingTicket, setShowingTicket] = useState(false);

  if (ended) {
    return (
      <p className="text-sm text-muted-foreground">
        {event.youreGoing
          ? "You were registered for this one."
          : "This event has ended."}
      </p>
    );
  }

  if (event.youreGoing) {
    return (
      <div className="flex flex-col gap-2">
        <p className="rounded-xl bg-cobalt-50 p-4 text-sm text-cobalt-800">
          <span className="font-semibold">You&rsquo;re going.</span> Show your
          ticket at the door to get in. We&rsquo;ll email you a reminder the day
          before.
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
        <TicketDialog
          clubId={event.clubId}
          eventId={event.id}
          open={showingTicket}
          onOpenChange={setShowingTicket}
        />
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

  // the places box above already says registration is closed
  if (!event.registrationOpen) return null;

  if (event.yourWaitlistPosition !== null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="rounded-xl bg-cobalt-50 p-4 text-sm text-cobalt-800">
          <span className="font-semibold">
            {event.yourWaitlistPosition === 1
              ? "You're next on the waitlist."
              : `You're number ${event.yourWaitlistPosition} on the waitlist.`}
          </span>{" "}
          If a place opens up, it&rsquo;s yours, and your ticket arrives by
          email.
        </p>
        <Button
          size="lg"
          variant="ghost"
          className="h-11 text-muted-foreground"
          onClick={onLeaveWaitlist}
          disabled={pending === "leave-waitlist"}
        >
          {pending === "leave-waitlist" && <Spinner />}
          {pending === "leave-waitlist" ? "Leaving…" : "Leave the waitlist"}
        </Button>
      </div>
    );
  }

  // full, or people already waiting: the queue is the way in
  if (full || event.waitlistCount > 0) {
    return (
      <Button
        size="lg"
        variant={event.canManage ? "outline" : "default"}
        className="h-11 font-semibold"
        disabled={pending === "waitlist"}
        onClick={onJoinWaitlist}
      >
        {pending === "waitlist" && <Spinner />}
        {pending === "waitlist" ? "Joining…" : "Join the waitlist"}
      </Button>
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
      {full
        ? "No places left"
        : pending === "register"
          ? "Registering…"
          : "Register"}
    </Button>
  );
}

function WhosGoing({
  event,
  attendees,
  ended,
}: EventPanelProps & { event: ClubEvent; ended: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const download = async () => {
    setDownloading(true);
    setDownloadFailed(false);
    try {
      await downloadAttendees(event.clubId, event.id, event.title);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };
  const shown = attendees.list.slice(0, 8);
  const more = attendees.list.length - shown.length;

  return (
    <section aria-labelledby="whos-going">
      <div className="flex items-center justify-between gap-2">
        <h3 id="whos-going" className="text-sm font-semibold">
          {ended || event.status === "cancelled"
            ? "Who registered"
            : "Who's going"}
          <span className="ml-1.5 font-normal text-muted-foreground">
            {event.registeredCount}
          </span>
        </h3>
        <button
          type="button"
          onClick={download}
          disabled={
            downloading || event.registeredCount + event.waitlistCount === 0
          }
          className="inline-flex items-center gap-1 text-sm font-medium text-cobalt underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          {downloading ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="size-3.5" aria-hidden />
          )}
          Download list
        </button>
      </div>
      {downloadFailed && (
        <p className="mt-1 text-sm text-destructive">
          Couldn&rsquo;t download the list. Try again in a moment.
        </p>
      )}
      {attendees.loading ? (
        <div className="mt-3 space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-7 w-40 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : attendees.failed ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Couldn&rsquo;t load the list. Close and reopen the event to try again.
        </p>
      ) : shown.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nobody yet. Share the event to get people in.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {shown.map((person) => (
            <li
              key={person.userId}
              className="flex items-center gap-2.5 text-sm"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-cobalt-50 text-[11px] font-semibold text-cobalt-800">
                {person.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("")}
              </span>
              <span className="truncate">{person.name}</span>
              {person.checkedInAt && (
                <span className="ml-auto text-xs text-muted-foreground">
                  checked in
                </span>
              )}
            </li>
          ))}
          {more > 0 && (
            <li className="pl-9.5 text-sm text-muted-foreground">
              and {more} more
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
