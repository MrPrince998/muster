"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { asApiError, request } from "@/lib/api/client";
import type { CheckInResult, DoorRoster, SyncResult } from "@/types/ticket.interface";

/** A check-in made with no connection, waiting to be sent. */
interface Queued {
  registrationId: string;
  userId: string;
  // when the door let them in, on this phone's clock
  at: string;
  name: string;
}

/** A ticket the door let in offline that, it turned out, shouldn't have got in. */
export interface DoorConflict {
  registrationId: string;
  name: string;
  outcome: "already_checked_in" | "cancelled" | "invalid";
  checkedInAt?: string;
  checkedInByName?: string | null;
}

interface DoorState {
  roster: DoorRoster | null;
  queue: Queued[];
  conflicts: DoorConflict[];
}

// --- the door's state, per event, kept on this phone ---------------------------------
// In localStorage, so a closed tab or a dead battery doesn't lose who got in.

const EMPTY: DoorState = { roster: null, queue: [], conflicts: [] };
const states = new Map<string, DoorState>();
const listeners = new Set<() => void>();
const storageKey = (eventId: string) => `muster:door:${eventId}`;

function readStored(eventId: string): Partial<DoorState> {
  try {
    const raw = localStorage.getItem(storageKey(eventId));
    return raw ? (JSON.parse(raw) as Partial<DoorState>) : {};
  } catch {
    return {};
  }
}

function getState(eventId: string): DoorState {
  let state = states.get(eventId);
  if (!state) {
    state = { ...EMPTY, ...readStored(eventId) };
    states.set(eventId, state);
  }
  return state;
}

function setState(eventId: string, change: (state: DoorState) => DoorState) {
  const next = change(getState(eventId));
  states.set(eventId, next);
  try {
    // nothing left to send and no list: nothing worth keeping
    if (next.queue.length === 0 && next.conflicts.length === 0 && !next.roster) localStorage.removeItem(storageKey(eventId));
    else localStorage.setItem(storageKey(eventId), JSON.stringify(next));
  } catch {
    // private browsing or a full disk: it still works for this visit
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const subscribeOnline = (listener: () => void) => {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

/**
 * The ids inside a ticket's code. Read without checking the signature: the
 * secret never leaves the server. Offline, what keeps a made-up code out is
 * the registration id inside it: random, and only on that person's ticket.
 */
export function readTicket(code: string): { registrationId: string; eventId: string } | null {
  try {
    const part = code.split(".")[1];
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const claims = JSON.parse(atob(base64)) as { sub?: unknown; evt?: unknown };
    return typeof claims.sub === "string" && typeof claims.evt === "string"
      ? { registrationId: claims.sub, eventId: claims.evt }
      : null;
  } catch {
    return null;
  }
}

// the door's count from its list and what's waiting to be sent
function counts(roster: DoorRoster | null, queue: Queued[]) {
  const tickets = roster?.tickets ?? [];
  const queued = new Set(queue.map((q) => q.registrationId));
  return {
    attendedCount: tickets.filter((t) => !t.cancelled && (t.checkedInAt || queued.has(t.registrationId))).length,
    registeredCount: tickets.filter((t) => !t.cancelled).length,
  };
}

const ROSTER_REFRESH_MS = 60_000;
const SYNC_RETRY_MS = 10_000;

/**
 * Check-in that keeps working without a connection. Online, the door uses
 * the API as before, and keeps a copy of the door's list. When the API
 * can't be reached, tickets are checked against that list on the phone and
 * queued; the queue is sent as soon as the connection is back, and anything
 * the server refuses (used at another door first, say) is reported.
 */
export function useOfflineDoor(
  clubId: string,
  eventId: string,
  enabled: boolean,
  // the server's count after a send
  onCounts: (counts: { attendedCount: number; registeredCount: number }) => void,
) {
  const state = useSyncExternalStore(subscribe, () => getState(eventId), () => EMPTY);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  // the browser thinks it's online, but the API didn't answer
  const [unreachable, setUnreachable] = useState(false);
  const offline = !online || unreachable;
  const syncing = useRef(false);

  const refreshRoster = useCallback(async () => {
    try {
      const roster = await request<DoorRoster>({ url: `/clubs/${clubId}/events/${eventId}/check-in/roster` });
      setState(eventId, (s) => ({ ...s, roster }));
      setUnreachable(false);
    } catch (error) {
      if (asApiError(error).code === "NETWORK_ERROR") setUnreachable(true);
    }
  }, [clubId, eventId]);

  /** Sends what was let in offline. Safe to call any time; one send at a time. */
  const sync = useCallback(async (): Promise<void> => {
    const pending = getState(eventId).queue.slice(0, 500);
    if (pending.length === 0 || syncing.current) return;
    syncing.current = true;
    try {
      const res = await request<SyncResult>({
        method: "post",
        url: `/clubs/${clubId}/events/${eventId}/check-in/sync`,
        data: { checkIns: pending.map(({ registrationId, at }) => ({ registrationId, at })) },
      });
      const sent = new Map(pending.map((q) => [q.registrationId, q]));
      const conflicts = res.results
        // "already" at the very time this phone sent: an earlier send that went through but whose answer was lost
        .filter((r) => r.outcome !== "checked_in")
        .filter((r) => !(r.outcome === "already_checked_in" && r.checkedInAt === sent.get(r.registrationId)?.at))
        .map((r) => ({
          registrationId: r.registrationId,
          name: r.attendeeName ?? sent.get(r.registrationId)?.name ?? "A ticket",
          outcome: r.outcome as DoorConflict["outcome"],
          checkedInAt: r.checkedInAt,
          checkedInByName: r.checkedInByName,
        }));
      setState(eventId, (s) => ({
        ...s,
        queue: s.queue.filter((q) => !sent.has(q.registrationId)),
        conflicts: [...s.conflicts, ...conflicts],
      }));
      setUnreachable(false);
      void refreshRoster();
      onCounts({ attendedCount: res.attendedCount, registeredCount: res.registeredCount });
    } catch (error) {
      if (asApiError(error).code === "NETWORK_ERROR") setUnreachable(true);
    } finally {
      syncing.current = false;
    }
  }, [clubId, eventId, refreshRoster, onCounts]);

  // the list on opening, then now and then; a send whenever there's something to send
  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void refreshRoster(), 0);
    const timer = setInterval(() => void refreshRoster(), ROSTER_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, refreshRoster]);
  useEffect(() => {
    if (!enabled || state.queue.length === 0) return;
    const first = setTimeout(() => void sync(), 0);
    const timer = setInterval(() => void sync(), SYNC_RETRY_MS);
    window.addEventListener("online", sync);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", sync);
    };
  }, [enabled, state.queue.length, sync]);

  /**
   * Runs an online check-in, unless there's no connection: then it answers
   * null and the caller checks the ticket on the phone instead.
   */
  const tryOnline = useCallback(
    async <T>(work: () => Promise<T>): Promise<T | null> => {
      if (!navigator.onLine) return null;
      try {
        const result = await work();
        setUnreachable(false);
        return result;
      } catch (error) {
        if (asApiError(error).code === "NETWORK_ERROR") {
          setUnreachable(true);
          return null;
        }
        throw error;
      }
    },
    [],
  );

  // let someone in on the phone, from the list; null when there's no list to go by
  const admit = useCallback(
    (find: (roster: DoorRoster) => DoorRoster["tickets"][number] | undefined): CheckInResult | null => {
      const { roster, queue } = getState(eventId);
      if (!roster) return null;
      const ticket = find(roster);
      if (!ticket) return { outcome: "invalid", ...counts(roster, queue) };
      if (ticket.cancelled) return { outcome: "cancelled", attendeeName: ticket.name, ...counts(roster, queue) };
      const queued = queue.find((q) => q.registrationId === ticket.registrationId);
      if (ticket.checkedInAt || queued) {
        return {
          outcome: "already_checked_in",
          attendeeName: ticket.name,
          checkedInAt: ticket.checkedInAt ?? queued!.at,
          ...counts(roster, queue),
        };
      }
      const entry = { registrationId: ticket.registrationId, userId: ticket.userId, at: new Date().toISOString(), name: ticket.name };
      setState(eventId, (s) => ({ ...s, queue: [...s.queue, entry] }));
      return { outcome: "checked_in", attendeeName: ticket.name, checkedInAt: entry.at, ...counts(roster, [...queue, entry]) };
    },
    [eventId],
  );

  /** Checks a scanned code against the door's list, offline. */
  const checkLocally = useCallback(
    (code: string): CheckInResult | null => {
      const ids = readTicket(code);
      if (ids && ids.eventId !== eventId) {
        const { roster, queue } = getState(eventId);
        return roster ? { outcome: "wrong_event", ...counts(roster, queue) } : null;
      }
      return admit((roster) => (ids ? roster.tickets.find((t) => t.registrationId === ids.registrationId) : undefined));
    },
    [admit, eventId],
  );

  /** Checks someone in by name, offline. */
  const admitLocally = useCallback(
    (userId: string) => admit((roster) => roster.tickets.find((t) => t.userId === userId)),
    [admit],
  );

  const dismissConflicts = useCallback(() => setState(eventId, (s) => ({ ...s, conflicts: [] })), [eventId]);

  return {
    offline,
    hasRoster: !!state.roster,
    pending: state.queue,
    conflicts: state.conflicts,
    tryOnline,
    checkLocally,
    admitLocally,
    sync,
    dismissConflicts,
  };
}
