import { RequireSession } from "@/components/pages/auth/shared/session-guards";
import { WorkspaceShell } from "@/components/pages/workspace/workspace-shell";

/**
 * Every signed-in workspace page (/workspaces, /o/[slug], and what comes
 * next) shares this frame. As a layout it stays mounted while you move
 * between them: one navbar and one rail, only the page beside them changes.
 * The (workspace) folder groups routes without adding to the URL.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <WorkspaceShell>{children}</WorkspaceShell>
    </RequireSession>
  );
}
