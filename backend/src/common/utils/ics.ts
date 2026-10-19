/**
 * A calendar file (iCalendar, RFC 5545) for one event, so "Add to calendar"
 * works in Apple Calendar, Outlook and Google alike. Times are written in
 * UTC: every calendar shows them on its own clock, so nobody's zone is
 * guessed. The UID is the event's own, so adding it again after a change
 * updates the entry instead of duplicating it.
 */
export interface CalendarEvent {
  eventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  // bumps when the event changes, so calendars take the newer copy
  updatedAt?: Date;
  cancelled?: boolean;
}

// text values: backslash, semicolon, comma and line breaks are escaped
const escapeText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// 20261024T073000Z
const utc = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

// lines longer than 75 octets continue on the next line after a space
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // never split a multi-byte character
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines start with a space
  }
  return parts.join('\r\n ');
}

export function buildIcs(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Muster//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.eventId}@muster`,
    `DTSTAMP:${utc(new Date())}`,
    `SEQUENCE:${Math.floor((event.updatedAt ?? new Date(0)).getTime() / 1000)}`,
    `DTSTART:${utc(event.startsAt)}`,
    `DTEND:${utc(event.endsAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    ...(event.description
      ? [`DESCRIPTION:${escapeText(event.description)}`]
      : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
