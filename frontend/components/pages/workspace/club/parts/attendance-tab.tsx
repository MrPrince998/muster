"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClubAttendance } from "@/types";
import { stubParts } from "../../org-home/parts/format";

const monthName = new Intl.DateTimeFormat(undefined, { month: "short" });
const monthLong = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
// "2026-10" -> the 1st of that month, local; only for its name
const monthDate = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface AttendanceTabProps {
  data: ClubAttendance | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  // where an event opens: the club's events page with it selected
  eventHref: (eventId: string) => string;
  // the workspace's
  timeZone?: string;
}

/** How many came: the headline, the last 12 months, and each event. Presentational. */
export function AttendanceTab({ data, loading, failed, onRetry, eventHref, timeZone }: AttendanceTabProps) {
  if (loading) return <div className="h-72 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-hidden />;
  if (failed || !data) {
    return (
      <div className="rounded-xl border border-dashed p-8">
        <p className="text-xl font-bold font-stretch-80%">Couldn&rsquo;t load the numbers</p>
        <p className="mt-1 text-muted-foreground">Check your connection, then try again.</p>
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const { summary, months, events } = data;
  return (
    <div className="space-y-12">
      <Headline summary={summary} />
      <Months months={months} />
      <Events events={events} eventHref={eventHref} timeZone={timeZone} />
    </div>
  );
}

function Headline({ summary }: { summary: ClubAttendance["summary"] }) {
  const extras = [
    summary.upcomingEvents > 0 && `${plural(summary.upcomingEvents, "event", "events")} coming up.`,
    summary.guests > 0 &&
      `${plural(summary.guests, "place", "places")} went to ${summary.guests === 1 ? "a guest" : "guests"} from outside the workspace.`,
  ].filter(Boolean);

  if (summary.eventsHeld === 0) {
    return (
      <section aria-label="Overall">
        <p className="text-4xl leading-none font-extrabold font-stretch-70%">Nothing to count yet</p>
        <p className="mt-2 max-w-prose text-muted-foreground">
          The numbers show up here once an event is over: who registered, and who came.{" "}
          {extras.join(" ")}
        </p>
      </section>
    );
  }
  const rate = summary.attendanceRate === null ? null : Math.round(summary.attendanceRate * 100);
  return (
    <section aria-label="Overall">
      <p className="text-6xl leading-none font-extrabold text-cobalt font-stretch-70% sm:text-7xl">
        {rate === null ? "No one registered" : `${rate}% came`}
      </p>
      <p className="mt-3 max-w-prose text-lg">
        {summary.attended} of the {plural(summary.registered, "person", "people")} who registered for{" "}
        {summary.eventsHeld === 1 ? "the one event held" : `the ${summary.eventsHeld} events held`} checked in at the door.
      </p>
      {extras.length > 0 && <p className="mt-1 max-w-prose text-muted-foreground">{extras.join(" ")}</p>}
    </section>
  );
}

function Months({ months }: { months: ClubAttendance["months"] }) {
  const max = Math.max(1, ...months.map((m) => m.registered));
  const any = months.some((m) => m.events > 0);
  return (
    <section aria-labelledby="months-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="months-heading" className="text-2xl font-extrabold font-stretch-70%">
          The last 12 months
        </h2>
        <p className="flex items-center gap-4 text-sm text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-cobalt-100" />
            Registered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-cobalt" />
            Came
          </span>
        </p>
      </div>

      {/* the bars, for the eye; the table below says the same for screen readers */}
      <div className="mt-5 grid h-48 grid-cols-12 items-end gap-1.5 border-b sm:gap-3" aria-hidden>
        {months.map((m) => (
          <div
            key={m.month}
            title={`${monthLong.format(monthDate(m.month))}: ${m.attended} came of ${m.registered} registered`}
            className="relative flex h-full flex-col justify-end"
          >
            {m.registered > 0 && (
              <div className="relative w-full rounded-t-md bg-cobalt-100" style={{ height: `${(m.registered / max) * 100}%` }}>
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-md bg-cobalt"
                  style={{ height: `${(m.attended / m.registered) * 100}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-12 gap-1.5 text-center text-xs text-muted-foreground sm:gap-3" aria-hidden>
        {months.map((m) => (
          <span key={m.month}>{monthName.format(monthDate(m.month))}</span>
        ))}
      </div>
      {!any && <p className="mt-3 text-sm text-muted-foreground">No events were held in the last 12 months.</p>}

      <table className="sr-only">
        <caption>Registered and came, by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Events</th>
            <th scope="col">Registered</th>
            <th scope="col">Came</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{monthLong.format(monthDate(m.month))}</th>
              <td>{m.events}</td>
              <td>{m.registered}</td>
              <td>{m.attended}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Events({
  events,
  eventHref,
  timeZone,
}: {
  events: ClubAttendance["events"];
  eventHref: (id: string) => string;
  timeZone?: string;
}) {
  return (
    <section aria-labelledby="events-heading">
      <h2 id="events-heading" className="text-2xl font-extrabold font-stretch-70%">
        Event by event
      </h2>
      {events.length === 0 ? (
        <p className="mt-3 text-muted-foreground">No events yet. Published events show up here.</p>
      ) : (
        <ul className="mt-4 divide-y rounded-xl border">
          {events.map((e) => {
            const { day, month } = stubParts(e.startsAt, timeZone);
            const cancelled = e.status === "cancelled";
            const rate = e.registered > 0 ? e.attended / e.registered : 0;
            return (
              <li key={e.id}>
                <Link
                  href={eventHref(e.id)}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-cobalt-50/60 focus-visible:bg-cobalt-50 focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "flex size-11 shrink-0 flex-col items-center justify-center rounded-lg border leading-none",
                      cancelled || e.ended ? "text-muted-foreground" : "border-cobalt/30 text-cobalt",
                    )}
                    aria-hidden
                  >
                    <span className="text-lg font-extrabold font-stretch-70%">{day}</span>
                    <span className="text-[10px] font-semibold">{month}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", cancelled && "text-muted-foreground line-through decoration-stamp/60")}>
                      {e.title}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {cancelled ? (
                        "Cancelled"
                      ) : !e.ended ? (
                        `Coming up, ${e.registered} registered${e.capacity ? ` of ${e.capacity}` : ""}`
                      ) : (
                        <>
                          {/* phones: the count moves here, the column beside it is hidden */}
                          <span className="sm:hidden">
                            {e.attended} of {e.registered} came{e.guests > 0 ? `, ${plural(e.guests, "guest", "guests")}` : ""}
                          </span>
                          <span className="hidden sm:inline">
                            {e.guests > 0 ? `${plural(e.guests, "guest", "guests")} from outside the workspace` : "Over"}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                  {e.ended && !cancelled && (
                    <span className="hidden w-40 shrink-0 text-right text-sm sm:block">
                      <span className="font-semibold">{e.attended}</span>
                      <span className="text-muted-foreground"> of {e.registered} came</span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-cobalt-100" aria-hidden>
                        <span className="block h-full rounded-full bg-cobalt" style={{ width: `${rate * 100}%` }} />
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
