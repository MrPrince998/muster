export type RepeatEvery = 'week' | 'fortnight' | 'month';

// the clock on the wall in `zone`, as if it were UTC: lets dates be added up
// in local terms (18:30 stays 18:30 across a daylight-saving change)
export function toWallClock(at: Date, zone: string): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, Number(part.value)]),
  );
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, at.getUTCMilliseconds()));
}

/**
 * Back from the wall clock to a real instant. A time that doesn't exist (the
 * hour skipped when clocks go forward) lands just after the gap; one that
 * happens twice (clocks going back) is the first of the two.
 */
export function fromWallClock(wall: Date, zone: string): Date {
  // the zone's offset half a day either side: around any change, one is before it and one after
  const offset = (at: number) => toWallClock(new Date(at), zone).getTime() - at;
  const before = new Date(wall.getTime() - offset(wall.getTime() - 43_200_000));
  const after = new Date(wall.getTime() - offset(wall.getTime() + 43_200_000));
  const fits = (at: Date) => toWallClock(at, zone).getTime() === wall.getTime();
  // the earlier when it happens twice; in a gap, the old offset carries it past
  if (fits(before)) return before;
  if (fits(after)) return after;
  return before;
}

// the nth step from `wall`, on the wall clock; a month from the 31st is the
// last day of a shorter month, always counted from the first date (never drifting)
function step(wall: Date, every: RepeatEvery, n: number): Date {
  if (every !== 'month') {
    return new Date(wall.getTime() + n * (every === 'week' ? 7 : 14) * 86_400_000);
  }
  const year = wall.getUTCFullYear();
  const month = wall.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out = new Date(wall);
  out.setUTCFullYear(year, month, Math.min(wall.getUTCDate(), lastDay));
  return out;
}

/**
 * The dates of a recurring event: `count` occurrences, the first at the given
 * time, each later one at the same local time in `zone` and the same length.
 */
export function occurrences(
  startsAt: Date,
  endsAt: Date,
  every: RepeatEvery,
  count: number,
  zone: string,
): { startsAt: Date; endsAt: Date }[] {
  const wallStart = toWallClock(startsAt, zone);
  const wallLength = toWallClock(endsAt, zone).getTime() - wallStart.getTime();
  return Array.from({ length: count }, (_, n) => {
    const start = step(wallStart, every, n);
    return {
      startsAt: n === 0 ? startsAt : fromWallClock(start, zone),
      endsAt: n === 0 ? endsAt : fromWallClock(new Date(start.getTime() + wallLength), zone),
    };
  });
}

/**
 * Moves another event of a series the way one of them was moved: the same
 * change on the wall clock (a new time of day, a day later, a longer finish),
 * so every occurrence keeps its own date.
 */
export function shiftLike(
  event: { startsAt: Date; endsAt: Date },
  edited: { before: { startsAt: Date; endsAt: Date }; after: { startsAt: Date; endsAt: Date } },
  zone: string,
): { startsAt: Date; endsAt: Date } {
  const wall = (at: Date) => toWallClock(at, zone).getTime();
  const startShift = wall(edited.after.startsAt) - wall(edited.before.startsAt);
  const endShift = wall(edited.after.endsAt) - wall(edited.before.endsAt);
  return {
    startsAt: fromWallClock(new Date(wall(event.startsAt) + startShift), zone),
    endsAt: fromWallClock(new Date(wall(event.endsAt) + endShift), zone),
  };
}
