"use client";

import { Link2, Plus, RotateCw } from "lucide-react";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MyOrganisation, OrgRole } from "@/types/organisation.interface";

interface OrgRailViewProps {
  organisations: MyOrganisation[];
  loading: boolean;
  failed: boolean;
  activeSlug: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onJoin: () => void;
}

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Moderator",
  member: "Member",
};

/** "State University" -> "SU", "robotics" -> "R". */
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

// Round at rest, a rounded square on hover and when open (Discord's cue for
// "you are here"); with reduced motion the shape just switches.
const tileShape =
  "grid size-12 place-items-center rounded-full transition-[border-radius,background-color,color] duration-200 motion-reduce:transition-none hover:rounded-2xl focus-visible:rounded-2xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

const actionTile =
  "border border-dashed border-cobalt-300 bg-background text-cobalt hover:border-solid hover:border-cobalt hover:bg-cobalt hover:text-white";

// Desktop: the rail sits under the 3.5rem navbar instead of the full height.
const belowNavbar = { top: "3.5rem", height: "calc(100svh - 3.5rem)" };

/**
 * One tile per workspace you belong to, then create and join, in shadcn's
 * Sidebar: a 72px rail on desktop, a drawer on phones (opened from the
 * navbar), where rows show names because there's no hover for tooltips.
 * Presentational.
 */
const OrgRailView = ({
  organisations,
  loading,
  failed,
  activeSlug,
  onRetry,
  onCreate,
  onJoin,
}: OrgRailViewProps) => {
  const { isMobile, setOpenMobile } = useSidebar();
  // choosing something in the drawer closes it
  const closeDrawer = () => setOpenMobile(false);

  return (
    <Sidebar style={isMobile ? undefined : belowNavbar}>
      <SidebarContent>
        <nav aria-label="Your workspaces" className={cn("py-3", isMobile ? "px-3" : "px-0")}>
          {isMobile && <h2 className="px-2 pb-3 text-lg font-extrabold font-stretch-70%">Workspaces</h2>}

          <SidebarMenu className={isMobile ? "gap-1" : "items-center gap-2"}>
            {loading &&
              Array.from({ length: 3 }, (_, index) => (
                <SidebarMenuItem key={index}>
                  <div className="size-12 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
                </SidebarMenuItem>
              ))}

            {organisations.map((org) => {
              const active = org.slug === activeSlug;
              return (
                <SidebarMenuItem key={org.orgId} className={isMobile ? undefined : "flex w-full justify-center"}>
                  {isMobile ? (
                    <SidebarMenuButton
                      size="lg"
                      isActive={active}
                      className="h-14"
                      render={
                        <Link
                          href={`/o/${org.slug}`}
                          aria-current={active ? "page" : undefined}
                          onClick={closeDrawer}
                        />
                      }
                    >
                      <OrgInitials name={org.name} active={active} small />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{org.name}</span>
                        <span className="text-xs text-muted-foreground">{ROLE_LABEL[org.role]}</span>
                      </span>
                    </SidebarMenuButton>
                  ) : (
                    <OrgTile org={org} active={active} />
                  )}
                </SidebarMenuItem>
              );
            })}

            {failed && (
              <ActionItem mobile={isMobile} label="Couldn't load your workspaces. Try again" onClick={onRetry}>
                <RotateCw className="size-5" aria-hidden />
              </ActionItem>
            )}
          </SidebarMenu>

          {organisations.length > 0 && (
            <SidebarSeparator className={cn("my-3", isMobile ? "mx-2" : "mx-auto w-8")} />
          )}

          <SidebarMenu className={isMobile ? "gap-1" : "items-center gap-2"}>
            <ActionItem mobile={isMobile} label="Create a workspace" onClick={() => (closeDrawer(), onCreate())}>
              <Plus className="size-5" aria-hidden />
            </ActionItem>
            <ActionItem mobile={isMobile} label="Join a workspace" onClick={() => (closeDrawer(), onJoin())}>
              <Link2 className="size-5" aria-hidden />
            </ActionItem>
          </SidebarMenu>
        </nav>
      </SidebarContent>
    </Sidebar>
  );
};

function OrgInitials({ name, active, small }: { name: string; active: boolean; small?: boolean }) {
  return (
    <span
      className={cn(
        tileShape,
        "shrink-0 leading-none font-extrabold font-stretch-70%",
        small ? "size-10 text-base" : "text-lg",
        active
          ? "rounded-2xl bg-cobalt text-white"
          : "bg-background text-ink ring-1 ring-border group-hover:bg-cobalt-50 group-hover:text-cobalt-800",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Desktop tile: initials only, with the name and role in a tooltip. */
function OrgTile({ org, active }: { org: MyOrganisation; active: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={`/o/${org.slug}`}
            aria-label={org.name}
            aria-current={active ? "page" : undefined}
            className="group relative flex w-full justify-center rounded-full focus-visible:outline-none"
          />
        }
      >
        {/* the marker on the rail's edge: a dot on hover, a bar when open */}
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-cobalt transition-[height] duration-200 motion-reduce:transition-none",
            active ? "h-10" : "h-0 group-hover:h-5",
          )}
        />
        <OrgInitials name={org.name} active={active} />
      </TooltipTrigger>
      <TooltipContent side="right">
        <span className="font-semibold">{org.name}</span>
        <span className="opacity-70">{ROLE_LABEL[org.role]}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Create, join or retry: a dashed tile on desktop, a labelled row in the drawer. */
function ActionItem({
  mobile,
  label,
  onClick,
  children,
}: {
  mobile: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  if (mobile) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="h-14" onClick={onClick}>
          <span className={cn(tileShape, actionTile, "size-10 shrink-0")}>{children}</span>
          <span className="font-medium">{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem className="flex w-full justify-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" aria-label={label} onClick={onClick} className={cn(tileShape, actionTile)} />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export default OrgRailView;
