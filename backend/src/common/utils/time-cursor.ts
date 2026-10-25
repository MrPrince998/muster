/**
 * Page cursors for lists ordered by a timestamp, then id (keyset paging).
 *
 * Postgres keeps microseconds and a JS Date only milliseconds, so a cursor
 * made from the Date would land just before (or after) the row it came
 * from: the next page would repeat it, or skip rows in the same
 * millisecond. So the timestamp comes from Postgres as text, exact.
 */

/** SQL for the exact timestamp of `column`, to select `AS cursor_at` and pass to encodeTimeCursor. */
export const cursorAt = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** "<exact timestamp>_<id>", base64url: the last row shown, to continue after. */
export const encodeTimeCursor = (at: string, id: string): string => Buffer.from(`${at}_${id}`).toString('base64url');

/** The timestamp and id in a cursor, or null when it isn't one we made. */
export function decodeTimeCursor(cursor: string): { at: string; id: string } | null {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('_');
  return at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
}
