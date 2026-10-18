import type { Metadata } from "next";
import WorkspaceContainer from "@/components/pages/workspace/workspace.container";

export const metadata: Metadata = {
  title: "Workspaces",
};

// Rendered only in the browser, once the session is known (RequireSession in
// the layout), so the server can't pre-render it for Next's instant-navigation
// check. Opt out of the check instead of letting it warn on every request.
export const instant = false;

// The session guard, navbar and rail come from (workspace)/layout.tsx.
const page = () => {
  return <WorkspaceContainer />;
};

export default page;
