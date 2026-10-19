// "Saturday 24 October 2026, 18:30 to 22:00 (AEDT)", in the event's
// workspace's zone: where it happens, wherever the reader is
export function formatWhen(startsAt: Date, endsAt: Date, zone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
  const zoneName =
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(startsAt)
      .find((part) => part.type === 'timeZoneName')?.value ?? zone;
  const sameDay = day.format(startsAt) === day.format(endsAt);
  return sameDay
    ? `${day.format(startsAt)}, ${time.format(startsAt)} to ${time.format(endsAt)} (${zoneName})`
    : `${day.format(startsAt)}, ${time.format(startsAt)} to ${day.format(endsAt)}, ${time.format(endsAt)} (${zoneName})`;
}
