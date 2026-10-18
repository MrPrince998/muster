// Dates the way a ticket prints them: "Fri 24 Oct", "18:30".
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric" });
const month = new Intl.DateTimeFormat("en-GB", { month: "short" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const fullDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export const stubParts = (iso: string) => {
  const date = new Date(iso);
  return { day: day.format(date), month: month.format(date), weekday: weekday.format(date) };
};

export const formatTime = (iso: string) => time.format(new Date(iso));

export const formatFullDate = (iso: string) => fullDate.format(new Date(iso));

/** "18:30 to 22:00", or with dates when it runs past midnight. */
export function formatTimeRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return start.toDateString() === end.toDateString()
    ? `${formatTime(startIso)} to ${formatTime(endIso)}`
    : `${formatTime(startIso)} to ${weekday.format(end)} ${day.format(end)} ${month.format(end)}, ${formatTime(endIso)}`;
}
