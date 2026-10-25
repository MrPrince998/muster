"use client";

import { Link2Off } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClubSummary } from "@/types/club.interface";
import type { Invite } from "@/types/invite.interface";
import { CopyLinkButton, describeInvite } from "../../dialogs/invite-dialog";
import { useClubInvites, useRevokeInvite } from "../../services/invite.service";
import { ConfirmDialog } from "../../shared/confirm-dialog";
import { workspaceErrorMessage } from "../../shared/workspace-errors";

const STATUS_NOTE: Record<Exclude<Invite["status"], "active">, string> = {
  expired: "Expired",
  used_up: "Used up",
  revoked: "Turned off",
};

/** The links you can manage, one club at a time, with copy and turn off. */
export function InviteLinks({
  clubs,
  onCreate,
  className = "mt-12",
}: {
  clubs: ClubSummary[];
  onCreate: (clubId: string) => void;
  className?: string;
}) {
  const [clubId, setClubId] = useState(clubs[0]?.id);
  const club = clubs.find((c) => c.id === clubId) ?? clubs[0];
  const invites = useClubInvites(club?.id);
  const revoke = useRevokeInvite(club?.id ?? "");
  const [turningOff, setTurningOff] = useState<Invite | null>(null);

  if (!club) return null;

  return (
    <section aria-labelledby="invite-links" className={className}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="invite-links" className="text-2xl font-extrabold font-stretch-70%">
            Invite links
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Links that still exist. Turned-off links stop working at once.</p>
        </div>
        <Button variant="outline" onClick={() => onCreate(club.id)}>
          New link
        </Button>
      </div>

      {clubs.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Club">
          {clubs.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === club.id}
              onClick={() => setClubId(c.id)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                c.id === club.id ? "bg-cobalt text-white" : "bg-muted hover:bg-cobalt-50",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        {invites.isPending ? (
          <div className="h-20 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-hidden />
        ) : invites.isError ? (
          <p className="text-sm text-muted-foreground">Couldn&rsquo;t load the links.</p>
        ) : (invites.data ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-muted-foreground">
            No links for {club.isDefault ? "the workspace" : club.name} yet.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {(invites.data ?? []).map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    /join/{invite.code.slice(0, 8)}…
                    {invite.requiresApproval && (
                      <span className="ml-2 rounded-full bg-cobalt-50 px-2 py-0.5 text-xs font-semibold text-cobalt-800">
                        Needs approval
                      </span>
                    )}
                    {invite.status !== "active" && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        {STATUS_NOTE[invite.status]}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {describeInvite(invite)} Used {invite.useCount} {invite.useCount === 1 ? "time" : "times"}
                    {invite.createdByName ? `, made by ${invite.createdByName}` : ""}.
                  </p>
                </div>
                <div className="flex gap-2">
                  {invite.status === "active" && <CopyLinkButton code={invite.code} />}
                  <Button variant="ghost" onClick={() => setTurningOff(invite)} aria-label="Turn off this link">
                    <Link2Off aria-hidden />
                    Turn off
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!turningOff}
        onOpenChange={(open) => !open && setTurningOff(null)}
        title="Turn off this link?"
        body="Anyone who opens it afterwards can't join. People who already joined stay in."
        confirmLabel="Turn off"
        pendingLabel="Turning off…"
        destructive
        onConfirm={async () => {
          if (!turningOff) return null;
          try {
            await revoke.mutateAsync({ inviteId: turningOff.id });
            return null;
          } catch (error) {
            return workspaceErrorMessage(error);
          }
        }}
      />
    </section>
  );
}
