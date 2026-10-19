import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";

const feedKey = ["me", "calendar-feed"];

/** The secret part of your calendar feed links. Fetched only when asked for (`enabled`). */
export const useCalendarFeedToken = (enabled: boolean) =>
  useApiQuery<{ token: string }>(feedKey, { url: "/me/calendar-feed" }, { enabled });

/** A new secret: every feed link made with the old one stops working. */
export const useResetCalendarFeed = () =>
  useApiMutation<{ token: string }, void>(
    { method: "post", url: "/me/calendar-feed/reset" },
    { invalidates: [feedKey] },
  );

/** A club's feed: https for copying, webcal:// to open in a calendar app, and Google's subscribe page. */
export function clubFeedLinks(token: string, clubId: string) {
  const https = `${process.env.NEXT_PUBLIC_API_URL}/feeds/${encodeURIComponent(token)}/clubs/${clubId}.ics`;
  const webcal = https.replace(/^https?:\/\//, "webcal://");
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}
