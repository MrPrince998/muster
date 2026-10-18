import type { Metadata } from "next";
import OrgHomeContainer from "@/components/pages/workspace/org-home/org-home.container";

export const metadata: Metadata = {
  title: "Workspace",
};

// Rendered only in the browser, once the session is known (RequireSession in
// the layout), so the server can't pre-render it for Next's instant-navigation
// check. Opt out of the check instead of letting it warn on every request.
export const instant = false;

// A workspace you belong to: /o/state-uni. The rail (in the layout) switches between them.
export default function OrganisationPage() {
  return <OrgHomeContainer />;
}
