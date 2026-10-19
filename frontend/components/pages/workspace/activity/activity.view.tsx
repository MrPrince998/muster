"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AuditEntry } from "@/types/audit.interface";
import type { ClubSummary } from "@/types/club.interface";
import { formatFullDate, formatTime } from "../org-home/parts/format";

interface ActivityViewProps {
  allowed: boolean;
  timeZone?: string;
  clubs: ClubSummary[];
  clubId: string | null;
  onClubChange: (clubId: string | null) => void;
  entries: AuditEntry[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}

// "Today", "Yesterday", or the date, on the workspace's clock
function dayLabel(iso: string, zone?: string): string {
  const day = (date: Date) => formatFullDate(date.toISOString(), zone);
  const now = new Date();
  if (day(new Date(iso)) === day(now)) return "Today";
  if (day(new Date(iso)) === day(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return formatFullDate(iso, zone);
}

/** The workspace's audit log as a timeline, newest first, by day. Presentational. */
export default function ActivityView(props: ActivityViewProps) {
  const { entries, timeZone } = props;

  if (!props.allowed) {
    return (
      <section className="max-w-xl px-5 py-10 sm:px-8">
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">Activity is for admins</h1>
        <p className="mt-3 text-muted-foreground">The workspace&rsquo;s owner and admins can see who changed what.</p>
      </section>
    );
  }

  // consecutive lines on the same day share a heading
  const days: { label: string; entries: AuditEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.at, timeZone);
    if (days.at(-1)?.label === label) days.at(-1)!.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }

  return (
    <section className="w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Activity</h1>
          <p className="mt-2 text-muted-foreground">Who changed what: roles, members, events, invites and settings.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Show</span>
          <select
            value={props.clubId ?? ""}
            onChange={(e) => props.onClubChange(e.target.value || null)}
            className="h-10 rounded-lg border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">Everything</option>
            {props.clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {props.loading ? (
        <div className="mt-8 space-y-3" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60 motion-reduce:animate-none" />
          ))}
        </div>
      ) : props.failed ? (
        <div className="mt-8">
          <p className="text-muted-foreground">Couldn&rsquo;t load the activity.</p>
          <Button variant="outline" className="mt-3" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-8 text-muted-foreground">
          Nothing yet. Changes to roles, members, events and settings show up here as people make them.
        </p>
      ) : (
        <div className="mt-8 space-y-8">
          {days.map((day) => (
            <section key={day.label} aria-label={day.label}>
              <h2 className="text-sm font-semibold text-muted-foreground">{day.label}</h2>
              <ol className="mt-2 divide-y border-y">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="flex gap-4 py-3">
                    <time dateTime={entry.at} className="w-12 shrink-0 pt-0.5 text-sm text-muted-foreground tabular-nums">
                      {formatTime(entry.at, timeZone)}
                    </time>
                    <p className="min-w-0 text-[15px]">
                      <span className="font-semibold">{entry.actorName}</span> {entry.summary}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {props.hasMore && (
            <Button variant="outline" onClick={props.onMore} disabled={props.loadingMore}>
              {props.loadingMore && <LoaderCircle className="animate-spin" aria-hidden />}
              Show older
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
