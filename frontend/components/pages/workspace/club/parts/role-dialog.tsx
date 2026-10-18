"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import type { ClubPermission, ClubRole, RoleInput } from "@/types";
import { PERMISSION_GROUPS } from "./permission-labels";

/**
 * New role, or edit one: a name and what it allows. Permissions you don't
 * hold can't be added (the server refuses them too); ones the role already
 * has stay as they are. Mount it fresh for each role (key it).
 */
export function RoleDialog({
  open,
  onOpenChange,
  role,
  mine,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // null: a new role
  role: ClubRole | null;
  // the permissions you hold in this club
  mine: ReadonlySet<ClubPermission>;
  // resolves to an error message, or null when saved
  onSave: (input: RoleInput) => Promise<string | null>;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [chosen, setChosen] = useState<Set<ClubPermission>>(new Set(role?.permissions ?? []));
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (permission: ClubPermission, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(permission);
      else next.delete(permission);
      return next;
    });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setNameError("Give the role a name");
    if (trimmed.length > 50) return setNameError("50 characters at most");
    setNameError(null);
    setSaving(true);
    setError(null);
    const failure = await onSave({ name: trimmed, permissions: [...chosen] });
    setSaving(false);
    if (failure) setError(failure);
    else onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form method="post" onSubmit={save} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">
              {role ? `Edit ${role.name}` : "New role"}
            </DialogTitle>
            <DialogDescription>
              {role
                ? `${role.memberCount} ${role.memberCount === 1 ? "person holds" : "people hold"} it. Changes apply to them straight away.`
                : "It starts at the bottom of the list. Move it up once it's ready."}
            </DialogDescription>
          </DialogHeader>

          <Field data-invalid={!!nameError}>
            <FieldLabel htmlFor="role-name">Name</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput
                id="role-name"
                value={name}
                maxLength={50}
                autoFocus
                placeholder="Treasurer"
                aria-invalid={!!nameError}
                onChange={(event) => setName(event.target.value)}
              />
            </InputGroup>
            <FieldError>{nameError}</FieldError>
          </Field>

          {PERMISSION_GROUPS.map((group) => (
            <fieldset key={group.title}>
              <legend className="text-sm font-semibold">{group.title}</legend>
              <div className="mt-2 space-y-1">
                {group.permissions.map(({ value, label, hint }) => {
                  const had = role?.permissions.includes(value) ?? false;
                  // you can keep or drop what it has, but only add what you hold
                  const locked = !mine.has(value) && !had;
                  const id = `perm-${value}`;
                  return (
                    <label
                      key={value}
                      htmlFor={id}
                      className={`flex gap-3 rounded-lg p-2 ${locked ? "opacity-60" : "cursor-pointer hover:bg-muted/60"}`}
                    >
                      <Checkbox
                        id={id}
                        className="mt-0.5"
                        checked={chosen.has(value)}
                        disabled={locked}
                        onCheckedChange={(checked) => toggle(value, checked === true)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{label}</span>
                        <span className="block text-sm text-muted-foreground">
                          {locked ? "You don't have this yourself, so you can't give it." : hint}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <LoaderCircle className="animate-spin" aria-hidden />}
              {saving ? "Saving…" : role ? "Save role" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
