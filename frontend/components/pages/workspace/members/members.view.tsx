"use client";

import { Crown, LogOut, MoreHorizontal, SearchIcon, UserMinus, UserCog, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { ClubSummary } from "@/types/club.interface";
import type { OrgMember, OrgRole } from "@/types/organisation.interface";
import InviteDialog from "../dialogs/invite-dialog";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { formatDay } from "../shared/workspace-errors";
import { InviteLinks } from "./parts/invite-links";

export type MemberAction =
  | { kind: "role"; member: OrgMember; role: Exclude<OrgRole, "owner"> }
  | { kind: "remove"; member: OrgMember }
  | { kind: "owner"; member: OrgMember }
  | { kind: "leave" };

const ROLE_NAME: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", moderator: "Moderator", member: "Member" };

// what each role can do, in the words people use; shown when choosing one
const ROLE_HINT: Record<Exclude<OrgRole, "owner">, string> = {
  admin: "Settings, clubs and members",
  moderator: "Join requests and removing members",
  member: "Takes part in clubs and events",
};

interface MembersViewProps {
  members: OrgMember[];
  total: number;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  myId: string | null;
  myRole: OrgRole;
  workspaceName: string;
  actionsFor: (member: OrgMember) => { roles: Exclude<OrgRole, "owner">[]; canRemove: boolean; canMakeOwner: boolean };
  confirming: MemberAction | null;
  onConfirm: (action: MemberAction | null) => void;
  runConfirmed: () => Promise<string | null>;
  invitableClubs: ClubSummary[];
  // the club the invite dialog is open for, or null when closed
  invitingTo: string | null;
  onInvite: (clubId: string | null) => void;
}

/** Everyone in the workspace, with the actions your role allows. Presentational. */
const MembersView = (props: MembersViewProps) => {
  const { members, total, loading, failed, onRetry, query, onQueryChange, myId, myRole, workspaceName } = props;

  return (
    <section className="w-full max-w-4xl px-5 py-6 sm:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Members</h1>
          <p className="mt-2 text-muted-foreground">
            {loading ? "Everyone in " : `${total} ${total === 1 ? "person" : "people"} in `}
            {workspaceName}. Joining the workspace puts them in General; other clubs they join themselves.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {myRole !== "owner" && (
            <Button variant="outline" onClick={() => props.onConfirm({ kind: "leave" })}>
              <LogOut aria-hidden />
              Leave workspace
            </Button>
          )}
          {props.invitableClubs.length > 0 && (
            <Button onClick={() => props.onInvite(props.invitableClubs[0].id)}>
              <UserPlus aria-hidden />
              Invite people
            </Button>
          )}
        </div>
      </header>

      <InputGroup className="mt-6 h-10 max-w-sm">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Search members"
          placeholder="Search by name or email"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </InputGroup>

      <div className="mt-6">
        {loading ? (
          <ul className="divide-y rounded-xl border" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3 p-4">
                <div className="size-10 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
                <div className="h-4 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </li>
            ))}
          </ul>
        ) : failed ? (
          <div className="rounded-xl border border-dashed p-8">
            <p className="text-xl font-bold font-stretch-80%">Couldn&rsquo;t load the members</p>
            <p className="mt-1 text-muted-foreground">Check your connection, then try again.</p>
            <Button className="mt-4" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : members.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-muted-foreground">
            Nobody matches &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {members.map((member) => (
              <MemberRow key={member.userId} member={member} isMe={member.userId === myId} {...props} />
            ))}
          </ul>
        )}
      </div>

      {myRole === "owner" && (
        <p className="mt-4 text-sm text-muted-foreground">
          You own this workspace. To leave it, make someone else the owner first, from the menu next to their name.
        </p>
      )}

      {props.invitableClubs.length > 0 && <InviteLinks clubs={props.invitableClubs} onCreate={props.onInvite} />}

      {/* keyed by club: opening it for another club starts fresh */}
      {props.invitingTo && (
        <InviteDialog
          key={props.invitingTo}
          open
          onOpenChange={(open) => !open && props.onInvite(null)}
          clubs={props.invitableClubs}
          initialClubId={props.invitingTo}
        />
      )}

      <MemberConfirm {...props} />
    </section>
  );
};

function MemberRow({
  member,
  isMe,
  actionsFor,
  onConfirm,
}: MembersViewProps & { member: OrgMember; isMe: boolean }) {
  const { roles, canRemove, canMakeOwner } = actionsFor(member);
  const hasActions = roles.length > 0 || canRemove || canMakeOwner;
  const initials = member.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <li className="flex items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-cobalt-50 text-sm font-semibold text-cobalt-800">
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {member.name}
          {isMe && <span className="font-normal text-muted-foreground"> (you)</span>}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {member.email ? `${member.email}, ` : ""}joined {formatDay(member.joinedAt)}
        </p>
      </div>
      <RoleBadge role={member.role} />
      {hasActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label={`Manage ${member.name}`} />}
          >
            <MoreHorizontal aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {roles.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Change role</DropdownMenuLabel>
                {roles.map((role) => (
                  <DropdownMenuItem key={role} onClick={() => onConfirm({ kind: "role", member, role })}>
                    <UserCog aria-hidden />
                    <span className="flex flex-col">
                      <span>Make {ROLE_NAME[role].toLowerCase()}</span>
                      <span className="text-xs text-muted-foreground">{ROLE_HINT[role]}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}
            {canMakeOwner && (
              <>
                {roles.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => onConfirm({ kind: "owner", member })}>
                  <Crown aria-hidden />
                  Make owner
                </DropdownMenuItem>
              </>
            )}
            {canRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onConfirm({ kind: "remove", member })}>
                  <UserMinus aria-hidden />
                  Remove from workspace
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        // keeps the badges lined up with rows that have a menu
        <span className="size-9 shrink-0" aria-hidden />
      )}
    </li>
  );
}

function RoleBadge({ role }: { role: OrgRole }) {
  return (
    <span
      className={cn(
        "hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline",
        role === "owner" && "bg-cobalt text-white",
        role === "admin" && "bg-cobalt-50 text-cobalt-800",
        role === "moderator" && "bg-muted text-foreground",
        role === "member" && "text-muted-foreground",
      )}
    >
      {ROLE_NAME[role]}
    </span>
  );
}

/** The one confirmation dialog, worded for whichever action is waiting. */
function MemberConfirm({ confirming, onConfirm, runConfirmed, workspaceName }: MembersViewProps) {
  const copy = (() => {
    switch (confirming?.kind) {
      case "role":
        return {
          title: `Make ${confirming.member.name} ${ROLE_NAME[confirming.role].toLowerCase()}?`,
          body: `As ${ROLE_NAME[confirming.role].toLowerCase()}: ${ROLE_HINT[confirming.role].toLowerCase()}.`,
          confirmLabel: `Make ${ROLE_NAME[confirming.role].toLowerCase()}`,
          pendingLabel: "Saving…",
          destructive: false,
        };
      case "remove":
        return {
          title: `Remove ${confirming.member.name}?`,
          body: `They leave ${workspaceName} and every club in it. They can only come back the way anyone new joins.`,
          confirmLabel: "Remove",
          pendingLabel: "Removing…",
          destructive: true,
        };
      case "owner":
        return {
          title: `Make ${confirming.member.name} the owner?`,
          body: `They get full control of ${workspaceName}, including deleting it. You become an admin, and they also take over the General club.`,
          confirmLabel: "Make owner",
          pendingLabel: "Handing over…",
          destructive: true,
        };
      case "leave":
        return {
          title: `Leave ${workspaceName}?`,
          body: "You leave every club in it. To come back, you'd join again the way anyone new does.",
          confirmLabel: "Leave workspace",
          pendingLabel: "Leaving…",
          destructive: true,
        };
      default:
        return null;
    }
  })();

  return (
    <ConfirmDialog
      open={!!confirming}
      onOpenChange={(open) => !open && onConfirm(null)}
      title={copy?.title ?? ""}
      body={copy?.body ?? ""}
      confirmLabel={copy?.confirmLabel ?? ""}
      pendingLabel={copy?.pendingLabel ?? ""}
      destructive={copy?.destructive}
      onConfirm={runConfirmed}
    />
  );
}

export default MembersView;
