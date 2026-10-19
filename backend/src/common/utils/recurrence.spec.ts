import { fromWallClock, occurrences, shiftLike, toWallClock } from './recurrence.js';

const iso = (dates: { startsAt: Date; endsAt: Date }[]) => dates.map((d) => [d.startsAt.toISOString(), d.endsAt.toISOString()]);

describe('recurring event dates', () => {
  it('repeats weekly at the same local time across a daylight-saving change', () => {
    // Sydney leaves daylight saving on the first Sunday of April 2027 (UTC+11 → UTC+10)
    const dates = occurrences(
      new Date('2027-03-25T07:30:00Z'), // Thu 18:30 in Sydney
      new Date('2027-03-25T10:00:00Z'), // 21:00
      'week',
      3,
      'Australia/Sydney',
    );
    expect(iso(dates)).toEqual([
      ['2027-03-25T07:30:00.000Z', '2027-03-25T10:00:00.000Z'],
      ['2027-04-01T07:30:00.000Z', '2027-04-01T10:00:00.000Z'],
      // still 18:30 to 21:00 on the clock, an hour later in UTC
      ['2027-04-08T08:30:00.000Z', '2027-04-08T11:00:00.000Z'],
    ]);
  });

  it('repeats fortnightly', () => {
    const dates = occurrences(new Date('2027-01-04T09:00:00Z'), new Date('2027-01-04T10:00:00Z'), 'fortnight', 3, 'UTC');
    expect(dates.map((d) => d.startsAt.toISOString().slice(0, 10))).toEqual(['2027-01-04', '2027-01-18', '2027-02-01']);
  });

  it('repeats monthly on the same date, or the last day of a shorter month', () => {
    const dates = occurrences(new Date('2027-01-31T09:00:00Z'), new Date('2027-01-31T10:00:00Z'), 'month', 4, 'Europe/London');
    // February has no 31st; March is the 31st again, not the 28th
    expect(dates.map((d) => d.startsAt.toISOString())).toEqual([
      '2027-01-31T09:00:00.000Z',
      '2027-02-28T09:00:00.000Z',
      // London is on summer time from 28 March: 09:00 on the clock is 08:00 UTC
      '2027-03-31T08:00:00.000Z',
      '2027-04-30T08:00:00.000Z',
    ]);
  });

  it('keeps an event that runs past midnight the same length on the clock', () => {
    const [, second] = occurrences(
      new Date('2027-06-04T12:00:00Z'), // Fri 22:00 in Sydney
      new Date('2027-06-04T16:00:00Z'), // Sat 02:00
      'week',
      2,
      'Australia/Sydney',
    );
    expect([second.startsAt.toISOString(), second.endsAt.toISOString()]).toEqual([
      '2027-06-11T12:00:00.000Z',
      '2027-06-11T16:00:00.000Z',
    ]);
  });

  it('turns a skipped hour into the time just after the gap', () => {
    // Sydney's clocks jump from 02:00 to 03:00 on 3 October 2027
    const at = fromWallClock(new Date('2027-10-03T02:30:00Z'), 'Australia/Sydney');
    expect(toWallClock(at, 'Australia/Sydney').toISOString()).toBe('2027-10-03T03:30:00.000Z');
  });

  it('takes the first of an hour that happens twice', () => {
    // Sydney's clocks go back from 03:00 to 02:00 on 4 April 2027: 02:30 is first at UTC+11
    expect(fromWallClock(new Date('2027-04-04T02:30:00Z'), 'Australia/Sydney').toISOString()).toBe('2027-04-03T15:30:00.000Z');
  });

  it('moves the rest of a series the way one was moved, each on its own date', () => {
    const zone = 'Australia/Sydney';
    const edited = {
      // 18:30-21:00 becomes 19:00-22:00, a day later
      before: { startsAt: new Date('2027-03-25T07:30:00Z'), endsAt: new Date('2027-03-25T10:00:00Z') },
      after: { startsAt: new Date('2027-03-26T08:00:00Z'), endsAt: new Date('2027-03-26T11:00:00Z') },
    };
    // a later one, after the clocks change
    const moved = shiftLike({ startsAt: new Date('2027-04-08T08:30:00Z'), endsAt: new Date('2027-04-08T11:00:00Z') }, edited, zone);
    expect(toWallClock(moved.startsAt, zone).toISOString()).toBe('2027-04-09T19:00:00.000Z');
    expect(toWallClock(moved.endsAt, zone).toISOString()).toBe('2027-04-09T22:00:00.000Z');
  });
});
