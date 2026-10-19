import { cache } from "react";
import type { PublicEvent, TicketWithCode } from "@/types";

// The API from the web server: inside Docker that's another container
// (INTERNAL_API_URL), not the address the browser uses.
const API = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL!;

/**
 * A public event, read on the server for link previews (metadata and the
 * share image). Null for anything that isn't public, or if the API can't be
 * reached: the page then just gets generic metadata. Memoised per request,
 * so the metadata and the image don't fetch it twice.
 */
export const getPublicEvent = cache(async (eventId: string): Promise<PublicEvent | null> => {
  try {
    const res = await fetch(`${API}/public/events/${encodeURIComponent(eventId)}`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as PublicEvent) : null;
  } catch {
    return null;
  }
});

/**
 * A ticket, read on the server by its signed token (what a guest's link and
 * every ticket's QR code hold). Null if it's been given back, the token is
 * wrong, or the API can't be reached.
 */
export async function getTicket(token: string): Promise<TicketWithCode | null> {
  try {
    const res = await fetch(`${API}/public/tickets/${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as TicketWithCode) : null;
  } catch {
    return null;
  }
}

/** "Sat 24 Oct, 19:30", in the event's own zone. */
export function formatWhen(event: PublicEvent): string {
  const at = new Date(event.startsAt);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: event.timeZone, weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: event.timeZone, hour: "2-digit", minute: "2-digit" });
  return `${day.format(at)}, ${time.format(at)}`;
}

/** What the share card and description say about places. */
export function placesLine(event: PublicEvent): string {
  if (event.status === "cancelled") return "Cancelled";
  if (event.ended) return "This event is over";
  if (!event.registrationOpen) return "Registration closed";
  if (event.placesLeft === null) return "Free, with a ticket";
  if (event.placesLeft === 0) return "Full: join the waitlist";
  return `${event.placesLeft} ${event.placesLeft === 1 ? "place" : "places"} left`;
}
