import type { Metadata } from "next";
import ClubDirectoryContainer from "@/components/pages/workspace/club-directory/club-directory.container";

export const metadata: Metadata = {
  title: "Clubs",
};

// Rendered only in the browser, once the session is known (RequireSession in
// the layout), so the server can't pre-render it for Next's instant-navigation
// check. Opt out of the check instead of letting it warn on every request.
export const instant = false;

// The clubs column and the workspace come from the /o/[slug] layout.
export default function Page() {
  return <ClubDirectoryContainer />;
}
