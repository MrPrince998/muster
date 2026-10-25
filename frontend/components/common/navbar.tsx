"use client";

import {
  ChevronDown,
  CircleHelp,
  LogOut,
  MessageSquarePlus,
  SearchIcon,
  Ticket,
  User,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { HOME, SIGN_IN } from "../pages/auth/shared/session-guards";
import SearchDialogContainer from "../pages/search/search-dialog.container";
import { useMe, useSignOut } from "../pages/auth/services/auth.service";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { buttonVariants } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Kbd } from "../ui/kbd";
import { Separator } from "../ui/separator";
import { SidebarTrigger } from "../ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/** "Prince Rana" -> "PR", "Ada" -> "A". */
function initialsOf(name: string | undefined) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** ⌘ on Apple keyboards, Ctrl elsewhere; null on the server, which can't know. */
const noSubscription = () => () => {};
function useModifierKey() {
  return React.useSyncExternalStore(
    noSubscription,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"),
    () => null,
  );
}

// Where "Send feedback" emails go; the button is hidden until it's set.
const FEEDBACK_EMAIL = process.env.NEXT_PUBLIC_FEEDBACK_EMAIL;

/** The app's top bar: home, search, help, and the account menu. */
const Navbar = () => {
  const router = useRouter();
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const modifier = useModifierKey();
  const { data: me } = useMe();
  const signOut = useSignOut();

  // ⌘K / Ctrl+K opens search from anywhere, and closes it again
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setIsSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onSignOut = () =>
    signOut.mutate(undefined, { onSettled: () => router.replace(SIGN_IN) });

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background px-4 sm:gap-4 sm:px-6">
      {/* phones: opens the workspace drawer (the rail is always shown on wider screens).
          The navbar sits inside WorkspaceShell's SidebarProvider, which this needs. */}
      <SidebarTrigger className="-ml-1 md:hidden" aria-label="Open workspaces" />
      <Link
        href={HOME}
        aria-label="Muster home"
        className="shrink-0 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Image
          src="/muster_logo_M.png"
          alt=""
          width={28}
          height={28}
          className="h-7 w-auto"
        />
      </Link>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* looks like a field, works as a button: it opens the search dialog */}
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-muted/60 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:max-w-sm"
        >
          <SearchIcon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Search pages, clubs, events and people</span>
          {modifier && (
            <Kbd className="ml-auto hidden sm:inline-flex">
              {modifier === "⌘" ? "⌘K" : "Ctrl K"}
            </Kbd>
          )}
        </button>

        <SearchDialogContainer open={isSearchOpen} onOpenChange={setIsSearchOpen} />

        {/* hidden on phones, where the drawer button needs the room and the
            account menu must stay on screen */}
        <div className="hidden items-center gap-1 sm:flex">
          {FEEDBACK_EMAIL && (
            <IconButton
              label="Send feedback"
              href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Muster feedback")}`}
            >
              <MessageSquarePlus />
            </IconButton>
          )}
          <IconButton label="Help" href="/help">
            <CircleHelp />
          </IconButton>

          <Separator orientation="vertical" className="mx-2 h-6" />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Your account"
            className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-popup-open:bg-muted"
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-cobalt-50 text-xs font-semibold text-cobalt-700">
                {initialsOf(me?.name) || (
                  <User className="size-4" aria-hidden />
                )}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-40 truncate text-sm font-medium md:block">
              {me?.name ?? "Your account"}
            </span>
            <ChevronDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-64">
            <div className="px-2 py-2">
              <p className="truncate text-sm font-semibold">
                {me?.name ?? "Loading…"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {me?.email}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/tickets")}>
              <Ticket aria-hidden />
              My tickets
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/account")}>
              <User aria-hidden />
              Account
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={onSignOut}
              disabled={signOut.isPending}
            >
              <LogOut aria-hidden />
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

/** An icon-only button with its name as a tooltip and for screen readers. */
function IconButton({
  label,
  href,
  children,
}: {
  label: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-label={label}
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default Navbar;
