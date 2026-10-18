"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ClubSummary } from "@/types/club.interface";
import type { ClubJoinRequest } from "@/types/invite.interface";
import { useApproveClubRequest, useClubJoinRequests, useRejectClubRequest } from "../../services/invite.service";
import { timeAgo, workspaceErrorMessage } from "../../shared/workspace-errors";

/**
 * One club's queue: people who opened a link that needs approval. Approving
 * lets them in with that link's role. For people with member.approve there.
 */
export function ClubRequestQueue({ club, orgId }: { club: ClubSummary; orgId: string }) {
  const requests = useClubJoinRequests(club.id);
  const approve = useApproveClubRequest(club.id, orgId);
  const reject = useRejectClubRequest(club.id, orgId);
  const [working, setWorking] = useState<{ id: string; decision: "approve" | "reject" } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const decide = async (request: ClubJoinRequest, decision: "approve" | "reject") => {
    setWorking({ id: request.id, decision });
    setError(null);
    try {
      await (decision === "approve" ? approve : reject).mutateAsync({ requestId: request.id });
      setAnnouncement(decision === "approve" ? `${request.name} is in ${club.name}.` : `Declined ${request.name}.`);
    } catch (failure) {
      setError({ id: request.id, message: workspaceErrorMessage(failure) });
    } finally {
      setWorking(null);
    }
  };

  const list = requests.data ?? [];

  return (
    <section aria-labelledby={`club-requests-${club.id}`} className="mt-10">
      <h2 id={`club-requests-${club.id}`} className="text-2xl font-extrabold font-stretch-70%">
        {club.name}
        {!requests.isPending && <span className="ml-2 text-base font-normal text-muted-foreground">{list.length}</span>}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        From invite links that need approval. Approving gives them the link&rsquo;s role
        {club.isDefault ? "." : `, and adds them to the workspace if they aren't in it.`}
      </p>
      <p className="sr-only" role="status">
        {announcement}
      </p>

      <div className="mt-4">
        {requests.isPending ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-hidden />
        ) : requests.isError ? (
          <p className="text-sm text-muted-foreground">Couldn&rsquo;t load this club&rsquo;s requests.</p>
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-muted-foreground">Nobody&rsquo;s waiting.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((request) => {
              const busy = working?.id === request.id ? working.decision : null;
              return (
                <li key={request.id} className="rounded-xl border p-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <p className="font-semibold">{request.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{request.email}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">Asked {timeAgo(request.createdAt)}</p>
                  </div>
                  <p className="mt-2 text-sm">
                    {request.roleName ? `Approving makes them ${request.roleName}.` : "Approving makes them a member."}
                  </p>
                  {error?.id === request.id && (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {error.message}
                    </p>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button onClick={() => decide(request, "approve")} disabled={!!working}>
                      {busy === "approve" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                      {busy === "approve" ? "Approving…" : "Approve"}
                    </Button>
                    <Button variant="outline" onClick={() => decide(request, "reject")} disabled={!!working}>
                      {busy === "reject" ? <LoaderCircle className="animate-spin" aria-hidden /> : <X aria-hidden />}
                      {busy === "reject" ? "Declining…" : "Decline"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
