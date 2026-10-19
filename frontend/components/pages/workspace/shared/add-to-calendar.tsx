"use client";

import { CalendarPlus, Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface CalendarEventInfo {
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  // a line for the entry's notes, e.g. the club and a link back
  details?: string;
}

// 2026-10-24T08:30:00.000Z → 20261024T083000Z, what Google's link takes
const googleTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A prefilled "new event" page in Google Calendar. */
export function googleCalendarUrl(event: CalendarEventInfo): string {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", event.title);
  url.searchParams.set("dates", `${googleTime(event.startsAt)}/${googleTime(event.endsAt)}`);
  if (event.location) url.searchParams.set("location", event.location);
  if (event.details) url.searchParams.set("details", event.details);
  return url.toString();
}

/**
 * "Add to calendar": a calendar file (Apple Calendar, Outlook, most others
 * open it) or Google Calendar. A public event's file is a plain link
 * (`icsHref`); a members-only one is fetched with your session (`onDownload`).
 */
export function AddToCalendar({
  event,
  icsHref,
  onDownload,
  className,
}: {
  event: CalendarEventInfo;
  icsHref?: string;
  onDownload?: () => Promise<void>;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const download = async () => {
    if (!onDownload) return;
    setSaving(true);
    setFailed(false);
    try {
      await onDownload();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" disabled={saving} />}>
          {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <CalendarPlus aria-hidden />}
          Add to calendar
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-60">
          {icsHref ? (
            <DropdownMenuItem render={<a href={icsHref} download />}>
              <Download aria-hidden />
              Apple, Outlook and others
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={download}>
              <Download aria-hidden />
              Apple, Outlook and others
            </DropdownMenuItem>
          )}
          <DropdownMenuItem render={<a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer" />}>
            <CalendarPlus aria-hidden />
            Google Calendar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&rsquo;t get the calendar file. Try again in a moment.
        </p>
      )}
    </div>
  );
}
