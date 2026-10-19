"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import CreateClubDialog from "../dialogs/create-club-dialog";
import { WorkspaceSidebar } from "../org-home/parts/workspace-sidebar";
import { useClubs, useOrganisation } from "../services/club.service";
import { useMyOrganisations } from "../services/organisation.service";
import { abilitiesFor, ROLE_RANK, WorkspaceProvider } from "./workspace-context";

/**
 * Everything under /o/[slug]: finds the workspace among yours, loads its
 * clubs, and frames each page with the clubs column (and, on phones, a row
 * of section links). Pages read the workspace with useWorkspace().
 */
export default function OrgShellContainer({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const organisations = useMyOrganisations();
  const organisation = organisations.data?.find((org) => org.slug === slug) ?? null;
  const orgId = organisation?.orgId;
  const clubs = useClubs(orgId);
  const detail = useOrganisation(orgId);
  const [creatingClub, setCreatingClub] = useState(false);

  if (organisations.isPending) {
    return (
      <div className="space-y-3 px-6 py-12 sm:px-10" role="status">
        <div className="h-12 w-72 max-w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-5 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <span className="sr-only">Loading the workspace</span>
      </div>
    );
  }

  if (organisations.isError) {
    return (
      <section className="space-y-4 px-6 py-12 sm:px-10">
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">Couldn&rsquo;t load this workspace</h1>
        <p className="text-muted-foreground">Check your connection, then try again.</p>
        <Button onClick={() => organisations.refetch()}>Try again</Button>
      </section>
    );
  }

  // not one of yours: you were removed, or the link is to a workspace you haven't joined
  if (!organisation) {
    return (
      <section className="max-w-xl space-y-4 px-6 py-12 sm:px-10">
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">You&rsquo;re not in this workspace</h1>
        <p className="text-muted-foreground">
          Ask one of its members for an invite link, or pick one of your workspaces on the left.
        </p>
        <Link href="/workspaces" className={buttonVariants({ variant: "outline" })}>
          Go to your workspaces
        </Link>
      </section>
    );
  }

  const can = abilitiesFor(organisation.role);
  const approvableClubs = (clubs.data ?? []).filter((club) => club.permissions.includes("member.approve"));
  // the Join requests page holds both queues: the workspace's (moderators) and each club's (approvers)
  const showRequests = can.reviewJoinRequests || approvableClubs.length > 0;
  const base = `/o/${organisation.slug}`;
  // phones have no clubs column: these links stand in for its workspace section
  const sections = [
    { href: base, label: "Events" },
    { href: `${base}/members`, label: "Members" },
    ...(showRequests ? [{ href: `${base}/join-requests`, label: "Join requests" }] : []),
    ...(can.changeSettings
      ? [
          { href: `${base}/activity`, label: "Activity" },
          { href: `${base}/settings`, label: "Settings" },
        ]
      : []),
  ];

  return (
    <WorkspaceProvider
      value={{
        organisation,
        detail: detail.data,
        rank: ROLE_RANK[organisation.role],
        approvableClubs,
        can,
        clubs: {
          data: clubs.data ?? [],
          loading: clubs.isPending,
          failed: clubs.isError,
          retry: () => clubs.refetch(),
        },
        openCreateClub: () => setCreatingClub(true),
      }}
    >
      <div className="flex min-h-[calc(100svh-3.5rem)]">
        <WorkspaceSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <nav aria-label="Workspace sections" className="flex gap-5 overflow-x-auto border-b px-5 sm:px-8 lg:hidden">
            {sections.map(({ href, label }) => {
              const active = href === base ? pathname === base : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "shrink-0 border-b-2 py-3 text-sm font-medium transition-colors",
                    active ? "border-cobalt text-cobalt-800" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="flex min-w-0 flex-1">{children}</div>
        </div>
      </div>
      <CreateClubDialog
        open={creatingClub}
        onOpenChange={setCreatingClub}
        orgId={organisation.orgId}
        workspaceName={organisation.name}
        onCreated={(club) => router.push(`${base}?club=${club.id}`)}
      />
    </WorkspaceProvider>
  );
}
