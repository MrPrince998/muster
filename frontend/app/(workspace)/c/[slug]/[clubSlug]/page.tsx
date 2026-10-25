import type { Metadata } from "next";
import ClubLinkContainer from "@/components/pages/workspace/join/club-link.container";

export const metadata: Metadata = {
  title: "Join a club",
};

// Rendered only in the browser, once the session is known (RequireSession in
// the layout, which sends signed-out visitors to sign in and back here).
export const instant = false;

// Where a club's own link (/c/{workspace}/{club}) lands.
export default function ClubLinkPage() {
  return <ClubLinkContainer />;
}
