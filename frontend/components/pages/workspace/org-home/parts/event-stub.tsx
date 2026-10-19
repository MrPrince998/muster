"use client";

import { cn } from "@/lib/utils";
import type { ClubEvent } from "@/types/event.interface";
import { formatTime, stubParts } from "./format";
import { seriesLabel } from "../../shared/series-scope-choice";
import { formatMoney } from "@/lib/money";

// The tear line between stub and body, with a notch punched at each end
// (the same ticket as on the sign-in page, turned on its side).
const notches = [
  "radial-gradient(circle 0.55rem at var(--tear) 0, transparent 98%, #000) top / 100% 51% no-repeat",
  "radial-gradient(circle 0.55rem at var(--tear) 100%, transparent 98%, #000) bottom / 100% 51% no-repeat",
].join(", ");

/**
 * One event as a ticket: the date on the stub, the details on the body.
 * The whole ticket is the button that opens the event panel.
 */
export function EventStub({
  event,
  selected,
  past,
  onOpen,
  timeZone,
}: {
  event: ClubEvent;
  // the workspace's: the event happens there
  timeZone?: string;
  selected: boolean;
  past: boolean;
  onOpen: () => void;
}) {
  const { day, month, weekday } = stubParts(event.startsAt, timeZone);
  // capacity null means no limit: never full, no bar
  const full = event.capacity !== null && event.registeredCount >= event.capacity;
  const draft = event.status === "draft";
  const cancelled = event.status === "cancelled";
  const filled =
    event.capacity === null ? 0 : Math.min(100, Math.round((event.registeredCount / event.capacity) * 100));

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      className="group block w-full text-left focus-visible:outline-none"
    >
      <div
        style={{ mask: notches, WebkitMask: notches }}
        className={cn(
          // --tear: where the stub ends, the dashed line runs and the notches are cut
          "grid grid-cols-[var(--tear)_1fr] rounded-xl transition-colors [--tear:5.25rem] sm:[--tear:6.5rem]",
          // outlines sit inside the edge: the notch mask clips anything drawn outside it
          selected
            ? "bg-cobalt-50 inset-ring-2 inset-ring-cobalt"
            : cn("inset-ring inset-ring-border group-hover:bg-cobalt-50/60", draft ? "bg-muted/50" : "bg-background"),
          "group-focus-visible:inset-ring-3 group-focus-visible:inset-ring-ring",
        )}
      >
        {/* stub: the date, as a ticket prints it */}
        <div
          className={cn(
            "flex flex-col items-center justify-center border-r-2 border-dashed border-border px-2 py-4",
            past || draft || cancelled ? "text-muted-foreground" : "text-cobalt",
          )}
        >
          <span className="text-4xl leading-none font-extrabold font-stretch-70%">{day}</span>
          <span className="mt-1 text-sm font-semibold">{month}</span>
          <span className="text-xs text-muted-foreground">{weekday}</span>
        </div>

        {/* body: what, when, where, and how full */}
        <div className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p
              className={cn(
                "truncate text-lg leading-tight font-bold font-stretch-80%",
                cancelled && "text-muted-foreground line-through decoration-stamp/60",
              )}
            >
              {event.title}
            </p>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {formatTime(event.startsAt, timeZone)}
              {event.location ? `, ${event.location}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {draft && <Tag tone="muted">Draft</Tag>}
              {cancelled && <Tag tone="stamp">Cancelled</Tag>}
              {event.series && <Tag tone="muted">{seriesLabel(event.series)}</Tag>}
              {event.price && (
                <Tag tone="muted">
                  {event.ticketTypes.length > 1 ? "From " : ""}
                  {formatMoney(event.price.amountCents, event.price.currency)}
                </Tag>
              )}
              {!draft && !cancelled && !past && !event.registrationOpen && <Tag tone="muted">Registration closed</Tag>}
              {!draft && !cancelled && event.visibility === "public" && <Tag tone="muted">Open to guests</Tag>}
              {!cancelled && !past && event.youreGoing && <Tag tone="cobalt">You&rsquo;re going</Tag>}
              {!cancelled && !past && event.yourWaitlistPosition !== null && (
                <Tag tone="muted">Waitlist, number {event.yourWaitlistPosition}</Tag>
              )}
              {!cancelled && past && event.youreGoing && <Tag tone="muted">You went</Tag>}
            </div>
          </div>

          {cancelled ? (
            <p className="shrink-0 text-sm text-muted-foreground sm:text-right">
              {event.registeredCount > 0 ? `${event.registeredCount} were told` : "Nobody had registered"}
            </p>
          ) : (
            <Capacity event={event} past={past} draft={draft} full={full} filled={filled} />
          )}
        </div>
      </div>
    </button>
  );
}

function Capacity({
  event,
  past,
  draft,
  full,
  filled,
}: {
  event: ClubEvent;
  past: boolean;
  draft: boolean;
  full: boolean;
  filled: number;
}) {
  if (draft) {
    return (
      <p className="shrink-0 text-sm text-muted-foreground">
        {event.capacity === null ? "No limit" : `${event.capacity} places`}, not published
      </p>
    );
  }
  if (past) {
    const turnout = event.registeredCount > 0 ? Math.round((event.attendedCount / event.registeredCount) * 100) : 0;
    return (
      <p className="shrink-0 text-sm sm:text-right">
        <span className="font-semibold">{event.attendedCount} came</span>
        <span className="block text-muted-foreground">
          {event.registeredCount > 0 ? `${turnout}% of ${event.registeredCount} registered` : "Nobody registered"}
        </span>
      </p>
    );
  }
  if (event.capacity === null) {
    return (
      <p className="shrink-0 text-sm sm:text-right">
        <span className="font-semibold">{event.registeredCount}</span>
        <span className="text-muted-foreground"> going, no limit</span>
      </p>
    );
  }
  return (
    <div className="w-full shrink-0 sm:w-36 sm:text-right">
      <p className="text-sm">
        {full ? (
          <span className="font-semibold text-stamp">
            Full
            {event.waitlistCount > 0 && (
              <span className="font-normal text-muted-foreground">, {event.waitlistCount} waiting</span>
            )}
          </span>
        ) : (
          <>
            <span className="font-semibold">{event.registeredCount}</span>
            <span className="text-muted-foreground"> of {event.capacity} places</span>
          </>
        )}
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full", full ? "bg-stamp" : "bg-cobalt")} style={{ width: `${filled}%` }} />
      </div>
    </div>
  );
}

function Tag({ tone, children }: { tone: "cobalt" | "muted" | "stamp"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "cobalt"
          ? "bg-cobalt-50 text-cobalt-800"
          : tone === "stamp"
            ? "bg-stamp/10 font-semibold text-stamp"
            : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
