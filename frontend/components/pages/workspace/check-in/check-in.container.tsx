"use client";

import { useParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { asApiError } from "@/lib/api/client";
import type { CheckInResult } from "@/types/ticket.interface";
import { useWorkspace } from "../org-shell/workspace-context";
import { useEvent, useEventAttendees } from "../services/event.service";
import { useCheckIn, useManualCheckIn } from "../services/ticket.service";
import CheckInView, { type DoorResult } from "./check-in.view";

// the same code read again within this window is the camera seeing it twice
const REPEAT_WINDOW_MS = 4000;

function failureMessage(code: string): string {
  switch (code) {
    case "EVENT_CANCELLED":
      return "This event was cancelled, so nobody can be checked in.";
    case "EVENT_NOT_FOUND":
      return "This event isn't open for check-in.";
    case "MISSING_PERMISSION":
      return "You can't check people in for this club.";
    case "NETWORK_ERROR":
      return "No connection. Nobody was checked in; scan again once you're back online.";
    default:
      return "Something went wrong. Nobody was checked in; scan again.";
  }
}

/** /o/[slug]/check-in/[clubId]/[eventId]: the door. */
export default function CheckInContainer() {
  const { clubId, eventId } = useParams<{ clubId: string; eventId: string }>();
  const { clubs, organisation } = useWorkspace();
  const club = clubs.data.find((c) => c.id === clubId);
  const canScan = !!club?.permissions.includes("checkin.scan");
  const canListAttendees = !!club?.permissions.includes("registration.view");

  const event = useEvent(canScan ? clubId : undefined, eventId);
  const attendees = useEventAttendees(clubId, eventId, canScan && canListAttendees);
  const checkIn = useCheckIn(clubId, eventId);
  const manual = useManualCheckIn(clubId, eventId);

  const [result, setResult] = useState<DoorResult | null>(null);
  const [counts, setCounts] = useState<{ attended: number; registered: number } | null>(null);
  const busy = useRef(false);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  const show = useCallback((outcome: CheckInResult) => {
    setResult({ ...outcome, at: Date.now() });
    setCounts({ attended: outcome.attendedCount, registered: outcome.registeredCount });
    // a buzz at the door: one for "in", three for "stop"
    navigator.vibrate?.(outcome.outcome === "checked_in" ? 80 : [60, 60, 60, 60, 60]);
  }, []);

  const onCode = useCallback(
    async (code: string) => {
      const now = Date.now();
      if (busy.current) return;
      if (lastCode.current && lastCode.current.code === code && now - lastCode.current.at < REPEAT_WINDOW_MS) return;
      lastCode.current = { code, at: now };
      busy.current = true;
      try {
        show(await checkIn.mutateAsync({ token: code }));
      } catch (error) {
        setResult({ failure: failureMessage(asApiError(error).code), at: Date.now() });
      } finally {
        busy.current = false;
      }
    },
    [checkIn, show],
  );

  const onManual = async (userId: string) => {
    try {
      show(await manual.mutateAsync({ userId }));
    } catch (error) {
      setResult({ failure: failureMessage(asApiError(error).code), at: Date.now() });
    }
  };

  return (
    <CheckInView
      timeZone={organisation.timeZone}
      clubLoading={clubs.loading}
      canScan={canScan}
      clubName={club?.name ?? ""}
      event={event.data ?? null}
      eventLoading={event.isPending && canScan}
      eventFailed={event.isError}
      attended={counts?.attended ?? event.data?.attendedCount ?? 0}
      registered={counts?.registered ?? event.data?.registeredCount ?? 0}
      result={result}
      onCode={onCode}
      canListAttendees={canListAttendees}
      attendees={attendees.data ?? []}
      attendeesLoading={attendees.isPending && canListAttendees}
      manualPending={manual.isPending ? (manual.variables?.userId ?? null) : null}
      onManual={onManual}
    />
  );
}
