// Dates the way a ticket prints them: "Fri 24 Oct", "18:30". In the event's
// workspace's zone when one is given (events happen where the club is),
// otherwise the device's.

const formatters = new Map<string, Intl.DateTimeFormat>();
function format(
  iso: string,
  options: Intl.DateTimeFormatOptions,
  zone?: string,
): string {
  const key = `${zone ?? ""}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      ...options,
      timeZone: zone,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(new Date(iso));
}

export const stubParts = (iso: string, zone?: string) => ({
  day: format(iso, { day: "numeric" }, zone),
  month: format(iso, { month: "short" }, zone),
  weekday: format(iso, { weekday: "short" }, zone),
});

export const formatTime = (iso: string, zone?: string) =>
  format(iso, { hour: "2-digit", minute: "2-digit" }, zone);

export const formatFullDate = (iso: string, zone?: string) =>
  format(
    iso,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    zone,
  );

/** "18:30 to 22:00", or with dates when it runs past midnight (in that zone). */
export function formatTimeRange(
  startIso: string,
  endIso: string,
  zone?: string,
) {
  const sameDay =
    formatFullDate(startIso, zone) === formatFullDate(endIso, zone);
  if (sameDay)
    return `${formatTime(startIso, zone)} to ${formatTime(endIso, zone)}`;
  const { weekday, day, month } = stubParts(endIso, zone);
  return `${formatTime(startIso, zone)} to ${weekday} ${day} ${month}, ${formatTime(endIso, zone)}`;
}
