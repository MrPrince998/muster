"use client";

import { useParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { asApiError } from "@/lib/api/client";
import type { CheckInResult } from "@/types/ticket.interface";
import { useWorkspace } from "../org-shell/workspace-context";
import { useDoorAttendees, useEvent } from "../services/event.service";
import { useCheckIn, useManualCheckIn } from "../services/ticket.service";
import CheckInView, { type DoorResult } from "./check-in.view";
import { useOfflineDoor } from "./use-offline-door";

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
    case "NO_DOOR_LIST":
      return "No connection, and this phone doesn't have the door list yet. Open check-in once with signal, then it works offline.";
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
  const attendees = useDoorAttendees(clubId, eventId, canScan && canListAttendees);
  const checkIn = useCheckIn(clubId, eventId);
  const manual = useManualCheckIn(clubId, eventId);
  const [result, setResult] = useState<DoorResult | null>(null);
  const [counts, setCounts] = useState<{ attended: number; registered: number } | null>(null);
  const onSynced = useCallback(
    ({ attendedCount, registeredCount }: { attendedCount: number; registeredCount: number }) =>
      setCounts({ attended: attendedCount, registered: registeredCount }),
    [],
  );
  const door = useOfflineDoor(clubId, eventId, canScan, onSynced);
  const busy = useRef(false);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  const show = useCallback((outcome: CheckInResult, offline = false) => {
    setResult({ ...outcome, offline, at: Date.now() });
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
        const online = await door.tryOnline(() => checkIn.mutateAsync({ token: code }));
        // no connection: the door's list on this phone decides, and the check-in waits to be sent
        const local = online ? null : door.checkLocally(code);
        if (online) show(online);
        else if (local) show(local, true);
        else setResult({ failure: failureMessage("NO_DOOR_LIST"), at: Date.now() });
      } catch (error) {
        setResult({ failure: failureMessage(asApiError(error).code), at: Date.now() });
      } finally {
        busy.current = false;
      }
    },
    [checkIn, door, show],
  );

  const onManual = async (userId: string) => {
    try {
      const online = await door.tryOnline(() => manual.mutateAsync({ userId }));
      const local = online ? null : door.admitLocally(userId);
      if (online) show(online);
      else if (local) show(local, true);
      else setResult({ failure: failureMessage("NO_DOOR_LIST"), at: Date.now() });
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
      // offline, the ones let in on this phone show as in
      attendees={(attendees.data ?? []).map((person) => {
        const queued = door.pending.find((q) => q.userId === person.userId);
        return queued && !person.checkedInAt ? { ...person, checkedInAt: queued.at } : person;
      })}
      door={{ offline: door.offline, pending: door.pending.length, conflicts: door.conflicts, onDismiss: door.dismissConflicts }}
      attendeesLoading={attendees.isPending && canListAttendees}
      manualPending={manual.isPending ? (manual.variables?.userId ?? null) : null}
      onManual={onManual}
    />
  );
}
