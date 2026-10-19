import { buildCalendar, buildIcs } from './ics.js';

const event = {
  eventId: '11111111-1111-4111-8111-111111111111',
  title: 'Robot Wars, Viewing; with pizza',
  startsAt: new Date('2026-10-24T08:30:00Z'),
  endsAt: new Date('2026-10-24T11:30:00Z'),
  location: 'Lecture Theatre 1',
  description:
    'Robotics Society, Riverside University\nYour ticket: https://app.example.org/tickets?ticket=x',
  url: 'https://app.example.org/e/11111111-1111-4111-8111-111111111111',
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

describe('calendar files', () => {
  it('writes one event, in UTC, with a stable id', () => {
    const ics = buildIcs(event);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain(
      'UID:11111111-1111-4111-8111-111111111111@muster\r\n',
    );
    expect(ics).toContain('DTSTART:20261024T083000Z\r\n');
    expect(ics).toContain('DTEND:20261024T113000Z\r\n');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
  });

  it('escapes text, so commas, semicolons and line breaks stay inside their field', () => {
    const ics = buildIcs(event);
    expect(ics).toContain('SUMMARY:Robot Wars\\, Viewing\\; with pizza\r\n');
    expect(ics.replace(/\r\n /g, '')).toContain(
      'DESCRIPTION:Robotics Society\\, Riverside University\\nYour ticket: https://',
    );
  });

  it('folds long lines at 75 bytes without splitting a character', () => {
    const ics = buildIcs({ ...event, description: 'Zoë '.repeat(60) });
    for (const line of ics.split('\r\n'))
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    // unfolded, the text is intact
    expect(ics.replace(/\r\n /g, '')).toContain(
      `DESCRIPTION:${'Zoë '.repeat(60)}`,
    );
  });

  it('marks a cancelled event, and a newer copy wins', () => {
    const older = buildIcs(event);
    const newer = buildIcs({
      ...event,
      cancelled: true,
      updatedAt: new Date('2026-10-05T00:00:00Z'),
    });
    expect(newer).toContain('STATUS:CANCELLED');
    const sequence = (ics: string) => Number(/SEQUENCE:(\d+)/.exec(ics)![1]);
    expect(sequence(newer)).toBeGreaterThan(sequence(older));
  });

  it('writes a feed: several events, a name, and how often to look again', () => {
    const feed = buildCalendar(
      [
        { ...event, eventId: 'a' },
        { ...event, eventId: 'b', cancelled: true },
      ],
      { name: 'Robotics Society, Riverside' },
    );
    expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(feed).toContain('X-WR-CALNAME:Robotics Society\\, Riverside\r\n');
    expect(feed).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(feed).toContain('UID:b@muster\r\n');
    expect(feed.indexOf('STATUS:CANCELLED')).toBeGreaterThan(feed.indexOf('UID:b@muster'));
  });
});
