"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ClubMember, ClubRole } from "@/types";
import { PERMISSION_LABEL } from "./permission-labels";

/**
 * Which roles someone holds. Roles at or above yours show but can't be
 * changed. Mount it fresh for each person (key it).
 */
export function MemberRolesDialog({
  open,
  onOpenChange,
  member,
  roles,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: ClubMember;
  // senior first
  roles: ClubRole[];
  onSave: (roleIds: string[]) => Promise<string | null>;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(member.roleIds));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed =
    chosen.size !== member.roleIds.length || member.roleIds.some((id) => !chosen.has(id));

  const save = async () => {
    setSaving(true);
    setError(null);
    // keep the server's order: senior first
    const failure = await onSave(roles.filter((role) => chosen.has(role.id)).map((role) => role.id));
    setSaving(false);
    if (failure) setError(failure);
    else onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">
            {member.name}&rsquo;s roles
          </DialogTitle>
          <DialogDescription>Their permissions are everything their roles allow, combined.</DialogDescription>
        </DialogHeader>

        <ul className="space-y-1">
          {roles.map((role) => {
            const id = `role-${role.id}`;
            const summary =
              role.permissions.length === 0
                ? "No permissions"
                : role.permissions.length <= 2
                  ? role.permissions.map((p) => PERMISSION_LABEL[p]).join(", ")
                  : `${PERMISSION_LABEL[role.permissions[0]]} and ${role.permissions.length - 1} more`;
            return (
              <li key={role.id}>
                <label
                  htmlFor={id}
                  className={`flex gap-3 rounded-lg p-2 ${role.assignable ? "cursor-pointer hover:bg-muted/60" : "opacity-60"}`}
                >
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={chosen.has(role.id)}
                    disabled={!role.assignable}
                    onCheckedChange={(checked) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (checked === true) next.add(role.id);
                        else next.delete(role.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{role.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {role.assignable ? summary : "At or above your own role"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !changed}>
            {saving && <LoaderCircle className="animate-spin" aria-hidden />}
            {saving ? "Saving…" : "Save roles"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
