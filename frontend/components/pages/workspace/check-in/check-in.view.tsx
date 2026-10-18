"use client";

import { Check, LoaderCircle, SearchIcon, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ClubEvent, EventAttendee } from "@/types/event.interface";
import type { CheckInResult } from "@/types/ticket.interface";
import { formatTime, formatTimeRange } from "../org-home/parts/format";
import { CameraScanner } from "./parts/camera-scanner";

/** What the door is showing: a scan's outcome, or why nothing happened. */
export type DoorResult = (CheckInResult | { failure: string }) & { at: number };

interface CheckInViewProps {
  clubLoading: boolean;
  canScan: boolean;
  clubName: string;
  event: ClubEvent | null;
  eventLoading: boolean;
  eventFailed: boolean;
  attended: number;
  registered: number;
  result: DoorResult | null;
  onCode: (code: string) => void;
  canListAttendees: boolean;
  attendees: EventAttendee[];
  attendeesLoading: boolean;
  manualPending: string | null;
  onManual: (userId: string) => void;
}

/** The door: scan tickets, or find people by name. Built for a phone held at arm's length. Presentational. */
const CheckInView = (props: CheckInViewProps) => {
  const { clubLoading, canScan, event, eventLoading, eventFailed } = props;
  const [mode, setMode] = useState<"scan" | "name">("scan");

  if (clubLoading || eventLoading) {
    return (
      <div className="flex w-full justify-center py-24" role="status">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Opening check-in</span>
      </div>
    );
  }

  if (!canScan || eventFailed || !event) {
    return (
      <section className="max-w-xl px-5 py-10 sm:px-8">
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">
          {!canScan ? "You can't check people in here" : "This event isn't open for check-in"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {!canScan
            ? `Check-in needs the Scanner role (or one above it) in ${props.clubName || "this club"}. Ask the club's owner.`
            : "It may be a draft, cancelled, or in a club you're not in."}
        </p>
      </section>
    );
  }

  const share = props.registered > 0 ? Math.round((props.attended / props.registered) * 100) : 0;

  return (
    <section aria-label={`Check-in for ${event.title}`} className="mx-auto w-full max-w-md px-4 py-5 sm:py-8">
      <header>
        <p className="text-sm font-semibold text-cobalt">{props.clubName}</p>
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">{event.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatTimeRange(event.startsAt, event.endsAt)}</p>
        {/* the door's running count */}
        <div className="mt-4" aria-live="polite">
          <p className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold font-stretch-70% tabular-nums">{props.attended}</span>
            <span className="text-muted-foreground">
              of {props.registered} in{props.registered > 0 ? ` (${share}%)` : ""}
            </span>
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-cobalt transition-[width] duration-300" style={{ width: `${share}%` }} />
          </div>
        </div>
      </header>

      {props.canListAttendees && (
        <Tabs value={mode} onValueChange={(value) => setMode(value as "scan" | "name")} className="mt-5">
          <TabsList className="w-full">
            <TabsTrigger value="scan">Scan tickets</TabsTrigger>
            <TabsTrigger value="name">Find by name</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <div className="mt-4 space-y-4">
        {mode === "scan" ? <CameraScanner onCode={props.onCode} /> : <NameSearch {...props} />}
        <ResultCard result={props.result} />
      </div>
    </section>
  );
};

/**
 * The answer for the person at the door, readable at a glance: green to let
 * them in, amber when the ticket was already used, red to stop.
 */
function ResultCard({ result }: { result: DoorResult | null }) {
  if (!result) {
    return (
      <p className="rounded-2xl border border-dashed p-5 text-center text-muted-foreground" role="status">
        Point the camera at a ticket&rsquo;s QR code.
      </p>
    );
  }

  const view = (() => {
    if ("failure" in result) {
      return { tone: "stop", icon: ShieldAlert, title: "Not checked in", detail: result.failure };
    }
    switch (result.outcome) {
      case "checked_in":
        return { tone: "go", icon: Check, title: "Let them in", detail: result.attendeeName ?? "" };
      case "already_checked_in":
        return {
          tone: "warn",
          icon: TriangleAlert,
          title: "Already checked in",
          detail: `${result.attendeeName ?? "This ticket"} got in at ${result.checkedInAt ? formatTime(result.checkedInAt) : "an earlier scan"}${
            result.checkedInByName ? `, scanned by ${result.checkedInByName}` : ""
          }.`,
        };
      case "cancelled":
        return {
          tone: "stop",
          icon: X,
          title: "Place cancelled",
          detail: `${result.attendeeName ?? "They"} gave this place back, so the ticket doesn't work.`,
        };
      case "wrong_event":
        return { tone: "stop", icon: X, title: "Wrong event", detail: "A real ticket, but for a different event." };
      default:
        return { tone: "stop", icon: X, title: "Not a valid ticket", detail: "It may be a screenshot of a changed code, expired, or not a Muster ticket." };
    }
  })();

  const Icon = view.icon;
  return (
    // keyed by time, so screen readers announce every scan, even a repeat outcome
    <div
      key={result.at}
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-2xl p-5 text-white",
        view.tone === "go" && "bg-emerald-600",
        view.tone === "warn" && "bg-amber-500 text-ink",
        view.tone === "stop" && "bg-stamp",
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/20">
        <Icon className="size-6" strokeWidth={3} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-2xl leading-none font-extrabold font-stretch-70%">{view.title}</p>
        {view.detail && <p className="mt-1.5 text-[15px] font-medium">{view.detail}</p>}
      </div>
    </div>
  );
}

function NameSearch({ attendees, attendeesLoading, manualPending, onManual }: CheckInViewProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = needle ? attendees.filter((a) => a.name.toLowerCase().includes(needle)) : attendees;

  return (
    <div className="rounded-2xl border">
      <div className="border-b p-3">
        <InputGroup className="h-11">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search attendees"
            placeholder="Type a name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </InputGroup>
      </div>
      {attendeesLoading ? (
        <div className="h-40 animate-pulse bg-muted/40 motion-reduce:animate-none" aria-hidden />
      ) : matches.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">
          {needle ? `Nobody registered matches "${query}".` : "Nobody is registered yet."}
        </p>
      ) : (
        <ul className="max-h-80 divide-y overflow-y-auto">
          {matches.map((person) => (
            <li key={person.userId} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
              {person.checkedInAt ? (
                <span className="text-sm text-muted-foreground">In at {formatTime(person.checkedInAt)}</span>
              ) : (
                <Button size="sm" onClick={() => onManual(person.userId)} disabled={!!manualPending}>
                  {manualPending === person.userId && <LoaderCircle className="animate-spin" aria-hidden />}
                  Check in
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CheckInView;
