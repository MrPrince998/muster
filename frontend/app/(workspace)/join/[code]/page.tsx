import type { Metadata } from "next";
import JoinInviteContainer from "@/components/pages/workspace/join/join-invite.container";

export const metadata: Metadata = {
  title: "Join",
  // the URL is a secret invite code: keep it out of search results
  robots: { index: false },
};

// Rendered only in the browser, once the session is known (RequireSession in
// the layout, which sends signed-out visitors to sign in and back here).
export const instant = false;

// Where an invite link (/join/{code}) lands.
export default function JoinPage() {
  return <JoinInviteContainer />;
}
