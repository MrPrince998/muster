"use client";

import Navbar from "@/components/common/navbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import OrgRailContainer from "./org-rail/org-rail.container";

// Discord's rail never hides on desktop, so the provider is held open (its
// Ctrl+B shortcut would otherwise hide it with no button to bring it back).
// On phones the rail is a drawer, opened from the navbar; that state is
// separate and still works.
const keepOpen = () => {};

/** The signed-in frame: navbar on top, workspace rail on the left, the page beside it. */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      open
      onOpenChange={keepOpen}
      className="flex-col"
      style={{ "--sidebar-width": "4.5rem" } as React.CSSProperties}
    >
      <Navbar />
      <div className="flex flex-1">
        <OrgRailContainer />
        <SidebarInset className="min-w-0">{children}</SidebarInset>
      </div>
    </SidebarProvider>
  );
}
