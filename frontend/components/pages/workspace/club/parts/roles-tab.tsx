"use client";

import { ArrowDown, ArrowUp, Crown, LoaderCircle, Lock, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ClubPermission, ClubRole, RoleInput } from "@/types";
import { ConfirmDialog } from "../../shared/confirm-dialog";
import { PERMISSION_LABEL } from "./permission-labels";
import { RoleDialog } from "./role-dialog";

export interface RolesTabProps {
  clubName: string;
  // senior first, Owner not included
  roles: ClubRole[];
  ownerName: string | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  canManageRoles: boolean;
  mine: ReadonlySet<ClubPermission>;
  // each resolves to an error message, or null when done
  onCreate: (input: RoleInput) => Promise<string | null>;
  onUpdate: (roleId: string, input: RoleInput) => Promise<string | null>;
  onMove: (roleId: string, direction: "up" | "down") => Promise<string | null>;
  onDelete: (roleId: string) => Promise<string | null>;
}

type Editing = { kind: "new" } | { kind: "edit"; role: ClubRole } | { kind: "delete"; role: ClubRole } | null;

/**
 * The club's roles in order of seniority. Higher outranks lower: people
 * manage only roles (and members) below their own, so order is the point.
 */
export function RolesTab(props: RolesTabProps) {
  const { roles, loading, failed, canManageRoles } = props;
  const [editing, setEditing] = useState<Editing>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = (open: boolean) => !open && setEditing(null);

  const move = async (role: ClubRole, direction: "up" | "down") => {
    setMoving(`${role.id}:${direction}`);
    setError(null);
    setError(await props.onMove(role.id, direction));
    setMoving(null);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Higher roles outrank lower ones. People can only give, change and remove roles below their own, and
          someone holding several roles gets everything those roles allow.
        </p>
        {canManageRoles && (
          <Button onClick={() => setEditing({ kind: "new" })}>
            <Plus aria-hidden />
            New role
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5">
        {loading ? (
          <div className="h-48 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-hidden />
        ) : failed ? (
          <div className="rounded-xl border border-dashed p-8">
            <p className="text-xl font-bold font-stretch-80%">Couldn&rsquo;t load the roles</p>
            <p className="mt-1 text-muted-foreground">Check your connection, then try again.</p>
            <Button className="mt-4" variant="outline" onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        ) : (
          <ol className="divide-y rounded-xl border">
            {/* Owner: always on top, never edited here */}
            <li className="flex items-start gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cobalt text-white">
                <Crown className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Owner</p>
                <p className="text-sm text-muted-foreground">
                  {props.ownerName ? `${props.ownerName}. ` : ""}Every permission. Changes hands only when the owner
                  makes someone else the owner.
                </p>
              </div>
            </li>
            {roles.map((role, index) => {
              const above = roles[index - 1];
              const below = roles[index + 1];
              const manage = canManageRoles && role.assignable;
              return (
                <li key={role.id} className="flex items-start gap-3 p-4">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-sm font-bold text-muted-foreground tabular-nums"
                    aria-hidden
                  >
                    {roles.length - index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 font-semibold">
                      {role.name}
                      <span className="text-sm font-normal text-muted-foreground">
                        {role.memberCount} {role.memberCount === 1 ? "person" : "people"}
                      </span>
                      {!role.assignable && (
                        <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                          <Lock className="size-3" aria-hidden />
                          At or above you
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {role.permissions.length === 0
                        ? "No permissions: a plain member."
                        : role.permissions.map((p) => PERMISSION_LABEL[p]).join(", ")}
                    </p>
                  </div>
                  {manage && (
                    <div className="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${role.name} up`}
                        disabled={!above?.assignable || moving !== null}
                        onClick={() => move(role, "up")}
                      >
                        {moving === `${role.id}:up` ? <LoaderCircle className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${role.name} down`}
                        disabled={!below || moving !== null}
                        onClick={() => move(role, "down")}
                      >
                        {moving === `${role.id}:down` ? (
                          <LoaderCircle className="animate-spin" aria-hidden />
                        ) : (
                          <ArrowDown aria-hidden />
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Manage ${role.name}`} />}>
                          <MoreHorizontal aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setEditing({ kind: "edit", role })}>
                            <Pencil aria-hidden />
                            Edit role
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setEditing({ kind: "delete", role })}>
                            <Trash2 aria-hidden />
                            Delete role
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {(editing?.kind === "new" || editing?.kind === "edit") && (
        <RoleDialog
          key={editing.kind === "edit" ? editing.role.id : "new"}
          open
          onOpenChange={close}
          role={editing.kind === "edit" ? editing.role : null}
          mine={props.mine}
          onSave={(input) => (editing.kind === "edit" ? props.onUpdate(editing.role.id, input) : props.onCreate(input))}
        />
      )}
      <ConfirmDialog
        open={editing?.kind === "delete"}
        onOpenChange={close}
        title={editing?.kind === "delete" ? `Delete ${editing.role.name}?` : ""}
        body={
          editing?.kind === "delete"
            ? `${
                editing.role.memberCount === 0
                  ? "Nobody holds it."
                  : `${editing.role.memberCount} ${editing.role.memberCount === 1 ? "person loses" : "people lose"} it and whatever it allowed.`
              } Invite links that gave it will give no role.`
            : ""
        }
        confirmLabel="Delete role"
        pendingLabel="Deleting…"
        dismissLabel="Keep role"
        destructive
        onConfirm={() => (editing?.kind === "delete" ? props.onDelete(editing.role.id) : Promise.resolve(null))}
      />
    </div>
  );
}
