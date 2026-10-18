"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { asApiError } from "@/lib/api/client";
import type { AuthUser } from "@/types";
import { useDeleteAccount } from "../../auth/services/auth.service";
import { useMyOrganisations } from "../../workspace/services/organisation.service";
import { ConfirmDialog } from "../../workspace/shared/confirm-dialog";
import { workspaceErrorMessage } from "../../workspace/shared/workspace-errors";
import { AccountRow } from "./account-row";

const linkClass =
  "font-semibold text-foreground underline underline-offset-4 hover:text-cobalt";

/**
 * Delete the account, after the password. Owners are told up front which
 * workspaces to hand over or delete first, instead of failing at the end.
 */
export function DeleteSection({ me }: { me: AuthUser }) {
  const router = useRouter();
  const workspaces = useMyOrganisations();
  const remove = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const owned = (workspaces.data ?? []).filter((w) => w.role === "owner");

  return (
    <AccountRow
      id="delete-heading"
      title="Delete account"
      description="Your memberships, registrations and tickets go with it. It can’t be undone."
    >
      {owned.length > 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm">
          <p className="font-medium">
            First, find a new owner for{" "}
            {owned.length === 1 ? "your workspace" : "your workspaces"}
          </p>
          <p className="mt-1 text-muted-foreground">
            A workspace can&rsquo;t be left without an owner. Hand it to another
            member, or delete it.
          </p>
          <ul className="mt-3 space-y-2">
            {owned.map((w) => (
              <li
                key={w.orgId}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1"
              >
                <span className="mr-auto font-medium">{w.name}</span>
                <Link href={`/o/${w.slug}/members`} className={linkClass}>
                  Hand over
                </Link>
                <Link href={`/o/${w.slug}/settings`} className={linkClass}>
                  Delete it
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Button
          variant="outline"
          className="h-11 border-destructive/40 px-4 text-[15px] font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive"
          disabled={workspaces.isPending}
          onClick={() => setOpen(true)}
        >
          Delete account
        </Button>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPassword("");
        }}
        title="Delete your account?"
        body={`${me.email} stops working on Muster, and every device signs out. Enter your password to confirm.`}
        confirmLabel="Delete account"
        pendingLabel="Deleting…"
        destructive
        confirmDisabled={!password}
        onConfirm={async () => {
          try {
            await remove.mutateAsync({ userId: me.id, password });
            router.replace("/login");
            return null;
          } catch (failure) {
            const code = asApiError(failure).code;
            if (code === "INVALID_PASSWORD") return "That’s not your password.";
            if (code === "OWNS_WORKSPACE")
              return "You own a workspace. Hand it over or delete it first.";
            if (code === "TOO_MANY_REQUESTS")
              return "Too many attempts. Wait a minute, then try again.";
            return workspaceErrorMessage(failure);
          }
        }}
      >
        <Field>
          <FieldLabel htmlFor="delete-password">Password</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="delete-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </InputGroup>
        </Field>
      </ConfirmDialog>
    </AccountRow>
  );
}
