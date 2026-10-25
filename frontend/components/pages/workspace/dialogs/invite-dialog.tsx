"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { asApiError } from "@/lib/api/client";
import type { ClubSummary } from "@/types/club.interface";
import type { Invite } from "@/types/invite.interface";
import { inviteUrl, useClubRoles, useCreateInvite } from "../services/invite.service";

const EXPIRY = [
  { value: "1", label: "After 1 day" },
  { value: "7", label: "After 7 days" },
  { value: "30", label: "After 30 days" },
  { value: "", label: "Never" },
];
const USES = [
  { value: "", label: "No limit" },
  { value: "1", label: "1 person" },
  { value: "10", label: "10 people" },
  { value: "25", label: "25 people" },
  { value: "100", label: "100 people" },
];

const selectClass =
  "h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** A one-line summary of what a link does: who it's for, how long, how many. */
export function describeInvite(invite: Pick<Invite, "role" | "maxUses" | "expiresAt" | "requiresApproval">): string {
  const role = invite.role ? `Gives the ${invite.role.name} role. ` : "";
  const uses = invite.maxUses === null ? "any number of people" : invite.maxUses === 1 ? "1 person" : `${invite.maxUses} people`;
  const until = invite.expiresAt
    ? `until ${new Date(invite.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : "with no end date";
  const approval = invite.requiresApproval ? " Each person is approved first." : "";
  return `${role}Works for ${uses}, ${until}.${approval}`;
}

/** Copies a link and says so for a moment. */
export function CopyLinkButton({ code, variant = "outline" }: { code: string; variant?: "outline" | "default" | "ghost" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (insecure origin, permissions): the link is on screen to copy by hand
    }
  };
  return (
    <Button type="button" variant={variant} onClick={copy} aria-live="polite">
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

/**
 * Make an invite link for one of the clubs you can invite to. The General
 * club's link is the workspace invite: joining it is joining the workspace.
 */
export default function InviteDialog({
  open,
  onOpenChange,
  clubs,
  initialClubId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // clubs where you have invite.manage, default club first
  clubs: ClubSummary[];
  initialClubId?: string;
}) {
  const [clubId, setClubId] = useState(initialClubId ?? clubs[0]?.id ?? "");
  const [roleId, setRoleId] = useState("");
  const [expiry, setExpiry] = useState("7");
  const [uses, setUses] = useState("");
  const [approve, setApprove] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roles = useClubRoles(open ? clubId : undefined);
  const createInvite = useCreateInvite(clubId);
  const club = clubs.find((c) => c.id === clubId);

  const reset = () => {
    setCreated(null);
    setError(null);
    setRoleId("");
  };

  const create = async () => {
    setError(null);
    try {
      setCreated(
        await createInvite.mutateAsync({
          defaultRoleId: roleId || null,
          maxUses: uses ? Number(uses) : null,
          expiresInDays: expiry ? Number(expiry) : null,
          requiresApproval: approve,
        }),
      );
    } catch (failure) {
      const code = asApiError(failure).code;
      setError(
        code === "ROLE_TOO_HIGH"
          ? "You can only give roles below your own."
          : code === "MISSING_PERMISSION"
            ? "You can't invite people to this club."
            : code === "NETWORK_ERROR"
              ? "Can't reach Muster. Check your connection, then try again."
              : "Couldn't create the link. Try again in a moment.",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {created ? (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">Your link is ready</DialogTitle>
              <DialogDescription>
                Anyone who opens it can {created.requiresApproval ? "ask to join" : "join"}{" "}
                {club?.isDefault ? "the workspace" : club?.name}. {describeInvite(created)}
              </DialogDescription>
            </DialogHeader>
            <input
              readOnly
              aria-label="Invite link"
              value={inviteUrl(created.code)}
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 w-full rounded-lg border bg-muted/50 px-3 text-sm"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Make another
              </Button>
              <CopyLinkButton code={created.code} variant="default" />
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">Invite people</DialogTitle>
              <DialogDescription>
                Make a link and share it. People who open it join straight away, and get added to the workspace if
                they aren&rsquo;t in it yet.
              </DialogDescription>
            </DialogHeader>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Into</span>
              <select
                className={selectClass}
                value={clubId}
                onChange={(event) => {
                  setClubId(event.target.value);
                  setRoleId("");
                }}
              >
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.isDefault ? `${c.name} (the whole workspace)` : c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Role</span>
              <select
                className={selectClass}
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
                disabled={roles.isPending}
              >
                <option value="">No role (a regular member)</option>
                {(roles.data ?? [])
                  .filter((role) => role.assignable)
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
              </select>
              <span className="block text-sm text-muted-foreground">
                Organizers can run events; only give roles to people you trust with them.
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Stops working</span>
                <select className={selectClass} value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                  {EXPIRY.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Who can use it</span>
                <select className={selectClass} value={uses} onChange={(event) => setUses(event.target.value)}>
                  {USES.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm has-checked:border-cobalt has-checked:bg-cobalt-50">
              <input
                type="checkbox"
                checked={approve}
                onChange={(event) => setApprove(event.target.checked)}
                className="mt-0.5 accent-cobalt"
              />
              <span>
                <span className="block font-medium">Approve each person</span>
                <span className="text-muted-foreground">
                  People ask to join and wait in the club&rsquo;s settings, under Join requests, until someone who can approve lets them in.
                </span>
              </span>
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={create} disabled={!clubId || createInvite.isPending}>
                {createInvite.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
                {createInvite.isPending ? "Creating…" : "Create link"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
