import { asApiError } from "@/lib/api/client";

/** What a refused workspace action means for the person, and what to do. */
export function workspaceErrorMessage(error: unknown): string {
  const apiError = asApiError(error);
  switch (apiError.code) {
    // the API's message already names the situation (who owns which club)
    case "OWNS_CLUB":
      return `${apiError.message}. Hand the club to someone else first.`;
    case "OWNER_CANNOT_LEAVE":
      return "Make someone else the owner first, then you can leave.";
    case "INSUFFICIENT_ORG_ROLE":
      return "Your role can't do that for this person. You can only manage people ranked below you.";
    case "MEMBER_NOT_FOUND":
      return "They're no longer in this workspace.";
    case "INVITE_NOT_FOUND":
      return "That link is already turned off.";
    case "JOIN_REQUEST_NOT_FOUND":
      return "Someone else already dealt with this request.";
    case "ALREADY_IN_CLUB":
      return "You're already in this club.";
    case "CLUB_INVITE_ONLY":
      return "This club now takes people by invite link only. Ask someone in it for one.";
    case "CLUB_NOT_FOUND":
      return "That club no longer exists.";
    case "SLUG_TAKEN":
      return "Another workspace already uses that address. Try a different one.";
    case "SLUG_RESERVED":
      return "That address is reserved by Muster. Try a different one.";
    case "CONFIRMATION_MISMATCH":
      return "That doesn't match the workspace's address.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Wait a minute, then try again.";
    case "NETWORK_ERROR":
      return "Can't reach Muster. Check your connection, then try again.";
    default:
      return "Something went wrong on our side. Try again in a moment.";
  }
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const formatDay = (iso: string) => day.format(new Date(iso));

const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
/** "5 minutes ago", "yesterday", "3 days ago". */
export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
