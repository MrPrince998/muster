import { config } from '../../config/config.js';

// "Saturday 24 October 2026, 18:30 to 22:00 (AEDT)", in the configured zone
export function formatWhen(startsAt: Date, endsAt: Date): string {
  const zone = config.timeZone;
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
