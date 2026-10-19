/**
 * Times in a workspace's zone. Events happen where the club is, so the app
 * shows (and the event form takes) times in the workspace's IANA zone, not
 * the viewer's device's.
 */

/** The device's own zone, e.g. "Australia/Sydney". */
export const deviceZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Whether times in `zone` would look different from the device's clock (so say which zone they're in). */
export const differsFromDevice = (zone: string | undefined): boolean =>
  !!zone && zone !== deviceZone();

// minutes `zone` is ahead of UTC at that instant ("GMT+11:00" -> 660)
function offsetMinutes(at: number, zone: string): number {
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(at))
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
}

/** "2026-10-24T18:30" on the clock in `zone` -> the instant, as ISO. */
export function wallClockToIso(local: string, zone: string): string {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // the offset can differ either side of a daylight-saving change: settle it at the result
  const first = wall - offsetMinutes(wall, zone) * 60_000;
  return new Date(wall - offsetMinutes(first, zone) * 60_000).toISOString();
}

/** The instant -> "2026-10-24T18:30" on the clock in `zone` (what a datetime-local input wants). */
export function isoToWallClock(iso: string, zone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The zone's short name at that moment: "AEDT", or "GMT+8" where there's no abbreviation. */
export function zoneName(iso: string, zone: string): string {
  return (
    new Intl.DateTimeFormat("en-AU", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date(iso))
      .find((part) => part.type === "timeZoneName")?.value ?? zone
  );
}

/** A zone's city, for people: "Australia/Perth" -> "Perth". */
export const zoneCity = (zone: string): string =>
  zone.split("/").pop()!.replace(/_/g, " ");
