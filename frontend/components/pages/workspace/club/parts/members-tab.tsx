"use client";

import { Crown, LogOut, MoreHorizontal, SearchIcon, ShieldCheck, UserMinus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { ClubMember, ClubRole } from "@/types";
import { initialsOf } from "../../org-rail/org-rail.view";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../../shared/confirm-dialog";
import { LoadMore } from "../../shared/load-more";
import { formatDay } from "../../shared/workspace-errors";
import { MemberRolesDialog } from "./member-roles-dialog";

export interface MembersTabProps {
  clubName: string;
  isDefault: boolean;
  members: ClubMember[];
  roles: ClubRole[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  myId: string | undefined;
  iAmOwner: boolean;
  canManageRoles: boolean;
  canRemove: boolean;
  // each resolves to an error message, or null when done
  onSetRoles: (userId: string, roleIds: string[]) => Promise<string | null>;
  onRemove: (userId: string) => Promise<string | null>;
  onTransfer: (userId: string) => Promise<string | null>;
  onLeave: () => Promise<string | null>;
  // the search runs on the server: the text, and the next page
  query: string;
  onQueryChange: (query: string) => void;
  searching: boolean;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}

type Confirming =
  | { kind: "roles"; member: ClubMember }
  | { kind: "remove"; member: ClubMember }
  | { kind: "transfer"; member: ClubMember }
  | { kind: "leave" }
  | null;

/** Who's in the club and what they hold; the actions your roles allow. */
export function MembersTab(props: MembersTabProps) {
  const { members: shown, roles, loading, failed, myId, iAmOwner, isDefault, query } = props;
  const [confirming, setConfirming] = useState<Confirming>(null);
  const roleName = new Map(roles.map((role) => [role.id, role.name]));
  const close = (open: boolean) => !open && setConfirming(null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InputGroup className="h-10 max-w-sm">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search the club's members"
            placeholder="Search by name"
            value={query}
            onChange={(event) => props.onQueryChange(event.target.value)}
          />
        </InputGroup>
        {!isDefault && !iAmOwner && !loading && !failed && (
          <Button variant="outline" onClick={() => setConfirming({ kind: "leave" })}>
            <LogOut aria-hidden />
            Leave club
          </Button>
        )}
      </div>

      <div className="mt-5">
        {loading ? (
          <ul className="divide-y rounded-xl border" aria-hidden>
            {[0, 1, 2].map((i) => (
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
            <Button className="mt-4" variant="outline" onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-muted-foreground">
            {props.searching ? "Searching…" : <>Nobody matches &ldquo;{query.trim()}&rdquo;.</>}
          </p>
        ) : (
          <>
          <ul className={cn("divide-y rounded-xl border transition-opacity", props.searching && "opacity-60")}>
            {shown.map((member) => {
              const isMe = member.userId === myId;
              const changeRoles = props.canManageRoles && member.manageable;
              const remove = props.canRemove && member.manageable && !isDefault;
              const handOver = iAmOwner && !isMe;
              return (
                <li key={member.userId} className="flex items-center gap-3 p-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-cobalt-50 text-sm font-semibold text-cobalt-800">
                    {initialsOf(member.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {member.name}
                      {isMe && <span className="font-normal text-muted-foreground"> (you)</span>}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">Joined {formatDay(member.joinedAt)}</p>
                    {/* on phones the roles sit under the name */}
                    <RoleChips member={member} roleName={roleName} className="mt-1.5 sm:hidden" />
                  </div>
                  <RoleChips member={member} roleName={roleName} className="hidden max-w-[45%] justify-end sm:flex" />
                  {changeRoles || remove || handOver ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon" aria-label={`Manage ${member.name}`} />}
                      >
                        <MoreHorizontal aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {changeRoles && (
                          <DropdownMenuItem onClick={() => setConfirming({ kind: "roles", member })}>
                            <ShieldCheck aria-hidden />
                            Change roles
                          </DropdownMenuItem>
                        )}
                        {handOver && (
                          <DropdownMenuItem onClick={() => setConfirming({ kind: "transfer", member })}>
                            <Crown aria-hidden />
                            Make owner
                          </DropdownMenuItem>
                        )}
                        {remove && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setConfirming({ kind: "remove", member })}>
                              <UserMinus aria-hidden />
                              Remove from club
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="size-8 shrink-0" aria-hidden />
                  )}
                </li>
              );
            })}
          </ul>
          {props.hasMore && (
            <LoadMore shown={shown.length} total={query.trim() ? null : props.total} loading={props.loadingMore} onMore={props.onMore} />
          )}
          </>
        )}
      </div>

      {isDefault ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Everyone in the workspace is in {props.clubName}. People join and leave it with the workspace.
        </p>
      ) : (
        iAmOwner && (
          <p className="mt-4 text-sm text-muted-foreground">
            You own this club. To leave it, make someone else the owner first, from the menu next to their name.
          </p>
        )
      )}

      {confirming?.kind === "roles" && (
        <MemberRolesDialog
          key={confirming.member.userId}
          open
          onOpenChange={close}
          member={confirming.member}
          roles={roles}
          onSave={(roleIds) => props.onSetRoles(confirming.member.userId, roleIds)}
        />
      )}
      <ConfirmDialog
        open={confirming?.kind === "remove"}
        onOpenChange={close}
        title={confirming?.kind === "remove" ? `Remove ${confirming.member.name}?` : ""}
        body={`They leave ${props.clubName} and lose their roles in it. They stay in the workspace, and can rejoin with an invite link.`}
        confirmLabel="Remove from club"
        pendingLabel="Removing…"
        dismissLabel="Keep them"
        destructive
        onConfirm={() => (confirming?.kind === "remove" ? props.onRemove(confirming.member.userId) : Promise.resolve(null))}
      />
      <ConfirmDialog
        open={confirming?.kind === "transfer"}
        onOpenChange={close}
        title={confirming?.kind === "transfer" ? `Make ${confirming.member.name} the owner?` : ""}
        body={`They get every permission in ${props.clubName}, and only they can hand it back. You keep running it from the most senior role below Owner.`}
        confirmLabel="Make owner"
        pendingLabel="Handing over…"
        onConfirm={() =>
          confirming?.kind === "transfer" ? props.onTransfer(confirming.member.userId) : Promise.resolve(null)
        }
      />
      <ConfirmDialog
        open={confirming?.kind === "leave"}
        onOpenChange={close}
        title={`Leave ${props.clubName}?`}
        body="You lose your roles in it and stop seeing its events. You stay in the workspace, and can rejoin with an invite link."
        confirmLabel="Leave club"
        pendingLabel="Leaving…"
        dismissLabel="Stay"
        destructive
        onConfirm={props.onLeave}
      />
    </div>
  );
}

function RoleChips({
  member,
  roleName,
  className,
}: {
  member: ClubMember;
  roleName: Map<string, string>;
  className?: string;
}) {
  const names = member.roleIds.map((id) => roleName.get(id)).filter((name): name is string => !!name);
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {member.isOwner && (
        <span className="inline-flex items-center gap-1 rounded-full bg-cobalt px-2 py-0.5 text-xs font-semibold text-white">
          <Crown className="size-3" aria-hidden />
          Owner
        </span>
      )}
      {names.map((name) => (
        <span key={name} className="rounded-full bg-cobalt-50 px-2 py-0.5 text-xs font-medium text-cobalt-800">
          {name}
        </span>
      ))}
      {!member.isOwner && names.length === 0 && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">No role</span>
      )}
    </div>
  );
}
