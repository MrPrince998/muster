"use client";

import { Inbox, Plus, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { OrgRole } from "@/types/organisation.interface";
import { useWorkspace } from "../../org-shell/workspace-context";

const ROLE_LINE: Record<OrgRole, string> = {
  owner: "You own this workspace",
  admin: "You're an admin",
  moderator: "You're a moderator",
  member: "You're a member",
};

const rowClass =
  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[15px] transition-colors focus-visible:ring-3 focus-visible:ring-white/50 focus-visible:outline-none";
const rowState = (active: boolean) =>
  active ? "bg-white font-semibold text-cobalt-800" : "text-white/85 hover:bg-white/10 hover:text-white";

/**
 * The second column (Discord's channel list): your clubs in this workspace,
 * then the workspace pages. Links, so every page under /o/[slug] can show
 * it. Hidden below lg, where the section links and club chips take over.
 */
export function WorkspaceSidebar() {
  const { organisation, detail, can, clubs, approvableClubs, openCreateClub } = useWorkspace();
  const pathname = usePathname();
  const clubParam = useSearchParams().get("club");
  const base = `/o/${organisation.slug}`;
  const onEvents = pathname === base;
  // the events page opens the default club (listed first) when none is chosen
  const activeClubId = onEvents ? (clubParam ?? clubs.data[0]?.id) : null;
  const memberCount = clubs.data.find((club) => club.isDefault)?.memberCount ?? null;
  // everyone waiting on you: the workspace's queue plus each club you approve for
  const pending =
    (detail?.pendingJoinRequests ?? 0) + approvableClubs.reduce((sum, club) => sum + club.pendingJoinRequests, 0);

  const workspaceLinks = [
    can.seeMembers && { href: `${base}/members`, icon: Users, label: "Members", count: memberCount, highlight: false },
    (can.reviewJoinRequests || approvableClubs.length > 0) && {
      href: `${base}/join-requests`,
      icon: Inbox,
      label: "Join requests",
      count: pending,
      highlight: pending > 0,
    },
    can.changeSettings && { href: `${base}/settings`, icon: Settings, label: "Settings", count: null, highlight: false },
  ].filter((link) => !!link);

  return (
    <aside
      aria-label={`${organisation.name} clubs`}
      className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-60 shrink-0 flex-col overflow-y-auto bg-cobalt-700 text-white lg:flex"
    >
      <header className="px-5 pt-6 pb-5">
        <p className="text-3xl leading-none font-extrabold font-stretch-70%">{organisation.name}</p>
        <p className="mt-2 text-sm text-white/70">{ROLE_LINE[organisation.role]}</p>
      </header>

      <nav aria-label="Clubs" className="px-3">
        <h2 className="px-2 pb-1 text-sm font-semibold text-white/60">Clubs</h2>
        <ul className="space-y-0.5">
          {clubs.loading &&
            [0, 1, 2].map((i) => (
              <li key={i} className="px-2 py-2" aria-hidden>
                <div className="h-4 w-32 animate-pulse rounded bg-white/15 motion-reduce:animate-none" />
              </li>
            ))}
          {clubs.data.map((club) => {
            const active = club.id === activeClubId;
            return (
              <li key={club.id}>
                <Link
                  href={`${base}?club=${club.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(rowClass, rowState(active))}
                >
                  <span className="min-w-0 flex-1 truncate">{club.name}</span>
                  {club.upcomingCount > 0 && (
                    <span className={cn("text-xs tabular-nums", active ? "text-cobalt-600" : "text-white/60")}>
                      {club.upcomingCount}
                      <span className="sr-only"> upcoming events</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
          {can.createClubs && (
            <li>
              <button
                type="button"
                onClick={openCreateClub}
                className={cn(rowClass, "text-white/70 hover:bg-white/10 hover:text-white")}
              >
                <Plus className="size-4 shrink-0" aria-hidden />
                New club
              </button>
            </li>
          )}
        </ul>
      </nav>

      <nav aria-label="Workspace" className="mt-6 px-3 pb-6">
        <h2 className="px-2 pb-1 text-sm font-semibold text-white/60">Workspace</h2>
        <ul className="space-y-0.5">
          {workspaceLinks.map(({ href, icon: Icon, label, count, highlight }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={label}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(rowClass, "gap-2.5", rowState(active))}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">{label}</span>
                  {count !== null &&
                    (highlight ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-xs font-bold tabular-nums",
                          active ? "bg-cobalt text-white" : "bg-white text-cobalt-800",
                        )}
                      >
                        {count}
                        <span className="sr-only"> waiting</span>
                      </span>
                    ) : (
                      <span className={cn("text-xs tabular-nums", active ? "text-cobalt-600" : "text-white/60")}>{count}</span>
                    ))}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
