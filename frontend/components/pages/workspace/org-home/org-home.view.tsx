"use client";

import { CalendarPlus, ChartColumn, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ClubSummary } from "@/types/club.interface";
import type { ClubEvent } from "@/types/event.interface";
import type { MyOrganisation } from "@/types/organisation.interface";
import EventFormDialog from "../dialogs/event-form-dialog";
import { useWorkspace } from "../org-shell/workspace-context";
import { EventPanel, type EventPanelProps } from "./parts/event-panel";
import { EventStub } from "./parts/event-stub";

export type EventTab = "upcoming" | "past" | "drafts";

type Dialog = "new-event" | "edit-event" | null;

export interface OrgHomePermissions {
  // checkin.scan: open the scanner for this club's events
  scanTickets: boolean;
  createEvents: boolean;
  publishEvents: boolean;
  seeDrafts: boolean;
  viewAttendees: boolean;
  // role.manage or member.remove: the club page has something for you to do
  manageClub: boolean;
  // analytics.view: the club page's attendance numbers
  seeAttendance: boolean;
}

interface OrgHomeViewProps {
  organisation: MyOrganisation;
  clubs: { data: ClubSummary[]; loading: boolean; failed: boolean; retry: () => void };
  club: ClubSummary | null;
  can: OrgHomePermissions;
  tab: EventTab;
  onTabChange: (tab: EventTab) => void;
  lists: Record<EventTab, { data: ClubEvent[]; loading: boolean; failed: boolean }>;
  onRetryEvents: () => void;
  openEvent: ClubEvent | null;
  onOpenEvent: (id: string | null) => void;
  panel: Pick<
    EventPanelProps,
    | "attendees"
    | "pending"
    | "error"
    | "onRegister"
    | "onCancel"
    | "onJoinWaitlist"
    | "onLeaveWaitlist"
    | "onPublish"
    | "onEdit"
    | "onToggleRegistration"
    | "onCancelEvent"
    | "onDeleteDraft"
  >;
  dialog: Dialog;
  onDialogChange: (dialog: Dialog) => void;
  onEventSaved: (event: ClubEvent) => void;
}

/**
 * A club's events, and the event you open. The workspace frame (clubs
 * column, loading, "not a member") comes from the /o/[slug] layout. Club
 * permissions change what's shown, never the layout. Presentational.
 */
const OrgHomeView = ({
  organisation,
  clubs,
  club,
  can,
  tab,
  onTabChange,
  lists,
  onRetryEvents,
  openEvent,
  onOpenEvent,
  panel,
  dialog,
  onDialogChange,
  onEventSaved,
}: OrgHomeViewProps) => {
  const { can: workspace, openCreateClub } = useWorkspace();
  const tabs: { value: EventTab; label: string }[] = [
    { value: "upcoming", label: "Upcoming" },
    { value: "past", label: "Past" },
    ...(can.seeDrafts ? [{ value: "drafts" as const, label: "Drafts" }] : []),
  ];
  const list = lists[tab];
  const closeDialog = (open: boolean) => !open && onDialogChange(null);

  return (
    <>
      <section
        aria-label={club ? `${club.name} events` : "Club events"}
        className="min-w-0 flex-1 px-5 py-6 sm:px-8 lg:py-8"
      >
        {/* below lg the clubs column is hidden: switch clubs here instead */}
        <div className="-mx-5 mb-6 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 lg:hidden">
          {clubs.data.map((c) => (
            <Link
              key={c.id}
              href={`/o/${organisation.slug}?club=${c.id}`}
              aria-current={c.id === club?.id ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                c.id === club?.id ? "bg-cobalt text-white" : "bg-muted text-foreground hover:bg-cobalt-50",
              )}
            >
              {c.name}
            </Link>
          ))}
          {workspace.createClubs && (
            <button
              type="button"
              onClick={openCreateClub}
              className="shrink-0 rounded-full border border-dashed border-cobalt-300 px-3.5 py-1.5 text-sm font-medium text-cobalt"
            >
              New club
            </button>
          )}
        </div>

        {clubs.failed ? (
          <div className="max-w-xl space-y-4">
            <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">Couldn&rsquo;t load the clubs</h1>
            <p className="text-muted-foreground">Check your connection, then try again.</p>
            <Button onClick={clubs.retry}>Try again</Button>
          </div>
        ) : !club ? (
          <div className="space-y-3" role="status">
            <div className="h-12 w-64 max-w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            <span className="sr-only">Loading clubs</span>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0 max-w-2xl">
                <p className="text-sm text-muted-foreground lg:hidden">{organisation.name}</p>
                <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">{club.name}</h1>
                {club.description && <p className="mt-2 text-muted-foreground">{club.description}</p>}
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="size-4" aria-hidden />
                  <Link
                    href={`/o/${organisation.slug}/clubs/${club.id}`}
                    className="underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {club.memberCount} {club.memberCount === 1 ? "member" : "members"}
                  </Link>
                  {can.createEvents && ", you can run events here"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {can.seeAttendance && (
                  <Link
                    href={`/o/${organisation.slug}/clubs/${club.id}?tab=attendance`}
                    className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11")}
                  >
                    <ChartColumn aria-hidden />
                    Attendance
                  </Link>
                )}
                {can.manageClub && (
                  <Link
                    href={`/o/${organisation.slug}/clubs/${club.id}`}
                    className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11")}
                  >
                    <ShieldCheck aria-hidden />
                    Manage club
                  </Link>
                )}
                {can.createEvents && (
                  <Button size="lg" className="h-11 font-semibold" onClick={() => onDialogChange("new-event")}>
                    <CalendarPlus aria-hidden />
                    New event
                  </Button>
                )}
              </div>
            </header>

            <Tabs value={tab} onValueChange={(value) => onTabChange(value as EventTab)} className="mt-8">
              <TabsList variant="line" className="h-10 gap-4 border-b p-0">
                {tabs.map(({ value, label }) => (
                  <TabsTrigger key={value} value={value} className="flex-none px-0 text-[15px] data-active:text-cobalt-800">
                    {label}
                    {!lists[value].loading && (
                      <span className="text-xs text-muted-foreground tabular-nums">{lists[value].data.length}</span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="mt-6 max-w-3xl">
              {list.loading ? (
                <ul className="space-y-3" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="h-28 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
                  ))}
                </ul>
              ) : list.failed ? (
                <div className="rounded-xl border border-dashed p-8">
                  <p className="text-xl font-bold font-stretch-80%">Couldn&rsquo;t load the events</p>
                  <p className="mt-1 text-muted-foreground">Check your connection, then try again.</p>
                  <Button className="mt-4" variant="outline" onClick={onRetryEvents}>
                    Try again
                  </Button>
                </div>
              ) : list.data.length === 0 ? (
                <EmptyTab tab={tab} club={club} canCreate={can.createEvents} onCreate={() => onDialogChange("new-event")} />
              ) : (
                <ul className="space-y-3">
                  {list.data.map((event) => (
                    <li key={event.id}>
                      <EventStub
                        event={event}
                        past={tab === "past"}
                        selected={openEvent?.id === event.id}
                        onOpen={() => onOpenEvent(openEvent?.id === event.id ? null : event.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      {club && (
        <EventPanel
          event={openEvent}
          clubName={club.name}
          canPublish={can.publishEvents}
          canViewAttendees={can.viewAttendees}
          canScan={can.scanTickets}
          scanHref={openEvent ? `/o/${organisation.slug}/check-in/${club.id}/${openEvent.id}` : ""}
          onClose={() => onOpenEvent(null)}
          {...panel}
        />
      )}

      {club && (
        <EventFormDialog
          open={dialog === "new-event" || dialog === "edit-event"}
          onOpenChange={closeDialog}
          clubId={club.id}
          clubName={club.name}
          orgId={organisation.orgId}
          canPublish={can.publishEvents}
          event={dialog === "edit-event" ? openEvent : null}
          onSaved={onEventSaved}
        />
      )}
    </>
  );
};

/** An empty tab says what to do next, and only offers what your permissions allow. */
function EmptyTab({
  tab,
  club,
  canCreate,
  onCreate,
}: {
  tab: EventTab;
  club: ClubSummary;
  canCreate: boolean;
  onCreate: () => void;
}) {
  const copy: Record<EventTab, { title: string; body: string }> = {
    upcoming: canCreate
      ? { title: "Nothing coming up", body: `Create an event and ${club.name} members can register straight away.` }
      : { title: "Nothing coming up", body: `When ${club.name} publishes an event, it shows up here.` },
    past: { title: "No past events yet", body: "Events move here once they've ended, with how many people came." },
    drafts: { title: "No drafts", body: "Events you save without publishing wait here. Only people who can edit them see them." },
  };
  return (
    <div className="rounded-xl border border-dashed p-8">
      <p className="text-xl font-bold font-stretch-80%">{copy[tab].title}</p>
      <p className="mt-1 max-w-prose text-muted-foreground">{copy[tab].body}</p>
      {canCreate && tab !== "past" && (
        <Button className="mt-4" onClick={onCreate}>
          <CalendarPlus aria-hidden />
          New event
        </Button>
      )}
    </div>
  );
}

export default OrgHomeView;
