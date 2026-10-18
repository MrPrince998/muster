import { Suspense } from "react";
import OrgShellContainer from "@/components/pages/workspace/org-shell/org-shell.container";

/**
 * Every page in a workspace (events, members, join requests, settings)
 * shares the clubs column. Suspense: the column reads ?club= from the URL,
 * which only exists in the browser.
 */
export default function OrganisationLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <OrgShellContainer>{children}</OrgShellContainer>
    </Suspense>
  );
}
