"use client";

import { Command as CommandPrimitive } from "cmdk";
import { CornerDownRight, History, LoaderCircle, SearchIcon, X } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { ClubHit, EventHit, PersonHit, SearchResult, WorkspaceHit } from "@/types";
import { stubParts } from "../workspace/org-home/parts/format";
import { initialsOf } from "../workspace/org-rail/org-rail.view";
import type { PageHit } from "./parts/app-pages";
import type { RecentPick } from "./parts/recent-searches";

export type SearchState =
  | { kind: "idle" }
  | { kind: "too-short" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "results"; result: SearchResult; refreshing: boolean };

/**
 * The value of the first row shown, in display order. The container keeps
 * it highlighted whenever the results change, so Enter always opens the top
 * match (cmdk would otherwise hold on to a row that's no longer there).
 */
export function firstRowValue(state: SearchState, recent: RecentPick[], pages: PageHit[]): string {
  if (state.kind === "idle") return recent[0] ? `recent:${recent[0].key}` : "";
  if (state.kind === "too-short") return "";
  if (pages[0]) return pages[0].key;
  if (state.kind !== "results") return "";
  const { events, clubs, workspaces, people } = state.result;
  if (events[0]) return `event:${events[0].id}`;
  if (clubs[0]) return `club:${clubs[0].id}`;
  if (workspaces[0]) return `workspace:${workspaces[0].orgId}`;
  if (people[0]) return `person:${people[0].orgSlug}:${people[0].userId}`;
  return "";
}

export interface SearchDialogViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  onTextChange: (text: string) => void;
  // the highlighted row (cmdk's value)
  selected: string;
  onSelectedChange: (value: string) => void;
  state: SearchState;
  // the app's own pages that match, shown first and at once (no request)
  pages: PageHit[];
  onPickPage: (hit: PageHit) => void;
  recent: RecentPick[];
  onClearRecent: () => void;
  onPickRecent: (pick: RecentPick) => void;
  onPickWorkspace: (hit: WorkspaceHit) => void;
  onPickClub: (hit: ClubHit) => void;
  onPickEvent: (hit: EventHit) => void;
  onPickPerson: (hit: PersonHit) => void;
}

const ROLE: Record<string, string> = { owner: "Owner", admin: "Admin", moderator: "Moderator", member: "Member" };
const YOUR_ROLE: Record<string, string> = {
  owner: "You own it",
  admin: "You're an admin",
  moderator: "You're a moderator",
  member: "You're a member",
};

/** The ⌘K box: type, arrow to a result, Enter to go there. Presentational. */
export default function SearchDialogView(props: SearchDialogViewProps) {
  const { open, onOpenChange, text, onTextChange, state } = props;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Find pages, workspaces, clubs, events and people"
      className="sm:max-w-xl"
    >
      {/* results come from the server already ranked: cmdk mustn't filter or reorder them */}
      <Command
        shouldFilter={false}
        value={props.selected}
        onValueChange={props.onSelectedChange}
        className="p-0"
      >
        <div className="flex items-center gap-3 border-b px-4">
          {state.kind === "loading" || (state.kind === "results" && state.refreshing) ? (
            <LoaderCircle className="size-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
          ) : (
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <CommandPrimitive.Input
            value={text}
            onValueChange={onTextChange}
            placeholder="Search pages, clubs, events and people"
            className="h-14 w-full bg-transparent text-base outline-hidden placeholder:text-muted-foreground"
          />
          {text && (
            <button
              type="button"
              onClick={() => onTextChange("")}
              aria-label="Clear search"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <CommandList className="max-h-[min(28rem,60svh)] p-2">
          <Body {...props} />
        </CommandList>

        <div className="hidden items-center gap-4 border-t px-4 py-2.5 text-xs text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> to open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}

function Body(props: SearchDialogViewProps) {
  const { state, text, recent } = props;

  if (state.kind === "idle") {
    if (recent.length === 0) {
      return <Hint>Find a page, or any workspace, club, event or person you share a workspace with.</Hint>;
    }
    return (
      <CommandGroup
        heading={
          <span className="flex items-center justify-between">
            Recent
            <button
              type="button"
              onClick={props.onClearRecent}
              className="font-normal underline-offset-4 hover:text-foreground hover:underline"
            >
              Clear
            </button>
          </span>
        }
      >
        {recent.map((pick) => (
          <Row
            key={pick.key}
            value={`recent:${pick.key}`}
            onSelect={() => props.onPickRecent(pick)}
            lead={
              <Tile tone="muted">
                <History className="size-4" aria-hidden />
              </Tile>
            }
            label={pick.label}
            detail={pick.detail}
          />
        ))}
      </CommandGroup>
    );
  }
  if (state.kind === "too-short") return <Hint>Keep typing: at least 2 letters.</Hint>;

  const pages = props.pages.length > 0 && (
    <CommandGroup heading="Pages">
      {props.pages.map((hit) => (
        <Row
          key={hit.key}
          value={hit.key}
          onSelect={() => props.onPickPage(hit)}
          lead={
            <Tile tone="muted">
              <CornerDownRight className="size-4" aria-hidden />
            </Tile>
          }
          label={hit.label}
          detail={hit.detail}
        />
      ))}
    </CommandGroup>
  );

  if (state.kind === "loading") {
    return (
      <>
        {pages}
        <Skeleton />
      </>
    );
  }
  if (state.kind === "failed") {
    return (
      <>
        {pages}
        <Hint>Search isn&rsquo;t working right now. Try again in a moment.</Hint>
      </>
    );
  }

  const { workspaces, clubs, events, people } = state.result;
  if (workspaces.length + clubs.length + events.length + people.length === 0) {
    return (
      pages || (
        <Hint>
          Nothing matches &ldquo;<span className="font-medium text-foreground">{text.trim()}</span>&rdquo;. Check the
          spelling, or try fewer letters.
        </Hint>
      )
    );
  }
  // the workspace name is only worth showing when results span several
  const many = new Set([...clubs, ...events, ...people].map((hit) => hit.orgSlug)).size > 1;
  const where = (hit: { orgName: string }, before?: string) =>
    [before, many ? hit.orgName : null].filter(Boolean).join(", ");

  return (
    <>
      {pages}
      {events.length > 0 && (
        <CommandGroup heading="Events">
          {events.map((hit) => (
            <EventRow key={hit.id} hit={hit} detail={where(hit, hit.clubName)} onSelect={() => props.onPickEvent(hit)} />
          ))}
        </CommandGroup>
      )}
      {clubs.length > 0 && (
        <CommandGroup heading="Clubs">
          {clubs.map((hit) => (
            <Row
              key={hit.id}
              value={`club:${hit.id}`}
              onSelect={() => props.onPickClub(hit)}
              lead={<Tile tone="cobalt">{initialsOf(hit.name)}</Tile>}
              label={hit.name}
              detail={where(hit) || "Club"}
            />
          ))}
        </CommandGroup>
      )}
      {workspaces.length > 0 && (
        <CommandGroup heading="Workspaces">
          {workspaces.map((hit) => (
            <Row
              key={hit.orgId}
              value={`workspace:${hit.orgId}`}
              onSelect={() => props.onPickWorkspace(hit)}
              lead={<Tile tone="solid">{initialsOf(hit.name)}</Tile>}
              label={hit.name}
              detail={YOUR_ROLE[hit.role] ?? "Workspace"}
            />
          ))}
        </CommandGroup>
      )}
      {people.length > 0 && (
        <CommandGroup heading="People">
          {people.map((hit) => (
            <Row
              key={`${hit.orgSlug}:${hit.userId}`}
              value={`person:${hit.orgSlug}:${hit.userId}`}
              onSelect={() => props.onPickPerson(hit)}
              lead={<Tile tone="round">{initialsOf(hit.name)}</Tile>}
              label={hit.name}
              detail={`${ROLE[hit.role] ?? "Member"} in ${hit.orgName}`}
            />
          ))}
        </CommandGroup>
      )}
    </>
  );
}

/** An event, led by its date as a tiny ticket stub prints it. */
function EventRow({ hit, detail, onSelect }: { hit: EventHit; detail: string; onSelect: () => void }) {
  const { day, month } = stubParts(hit.startsAt, hit.timeZone);
  const cancelled = hit.status === "cancelled";
  const over = hit.ended;
  const note = cancelled ? "Cancelled" : hit.status === "draft" ? "Draft" : over ? "Ended" : null;
  return (
    <Row
      value={`event:${hit.id}`}
      onSelect={onSelect}
      lead={
        <span
          className={cn(
            "flex size-10 shrink-0 flex-col items-center justify-center rounded-lg border leading-none",
            cancelled || over || hit.status === "draft" ? "text-muted-foreground" : "border-cobalt/30 text-cobalt",
          )}
          aria-hidden
        >
          <span className="text-base font-extrabold font-stretch-70%">{day}</span>
          <span className="text-[10px] font-semibold">{month}</span>
        </span>
      }
      label={<span className={cn(cancelled && "line-through decoration-stamp/60")}>{hit.title}</span>}
      detail={detail}
      note={note && <span className={cn("text-xs", cancelled ? "font-semibold text-stamp" : "text-muted-foreground")}>{note}</span>}
    />
  );
}

function Row({
  value,
  onSelect,
  lead,
  label,
  detail,
  note,
}: {
  value: string;
  onSelect: () => void;
  lead: React.ReactNode;
  label: React.ReactNode;
  detail: string;
  note?: React.ReactNode;
}) {
  return (
    <CommandItem value={value} onSelect={onSelect} className="gap-3 px-2 py-2 data-selected:bg-cobalt-50">
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      {note}
    </CommandItem>
  );
}

function Tile({ tone, children }: { tone: "cobalt" | "solid" | "round" | "muted"; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-10 shrink-0 place-items-center text-sm font-extrabold font-stretch-70%",
        tone === "solid" && "rounded-xl bg-cobalt text-white",
        tone === "cobalt" && "rounded-xl bg-cobalt-50 text-cobalt-800",
        tone === "round" && "rounded-full bg-muted text-foreground",
        tone === "muted" && "rounded-xl bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-8 text-center text-sm text-pretty text-muted-foreground">{children}</p>;
}

function Skeleton() {
  return (
    <div className="space-y-1 p-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-2">
          <div className="size-10 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
