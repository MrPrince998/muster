import type { Metadata } from "next";
import MembersContainer from "@/components/pages/workspace/members/members.container";

export const metadata: Metadata = {
  title: "Members",
};

// Rendered only in the browser, once the session is known (RequireSession in
// the layout), so the server can't pre-render it for Next's instant-navigation
// check. Opt out of the check instead of letting it warn on every request.
export const instant = false;

// The clubs column and the workspace come from the /o/[slug] layout.
export default function Page() {
  return <MembersContainer />;
}
