"use client";

import { useState } from "react";
import type { JoinRequest } from "@/types/organisation.interface";
import { useWorkspace } from "../org-shell/workspace-context";
import { useApproveJoinRequest, useJoinRequests, useRejectJoinRequest } from "../services/member.service";
import { workspaceErrorMessage } from "../shared/workspace-errors";
import JoinRequestsView, { type RequestTab } from "./join-requests.view";
import { ClubRequestQueue } from "./parts/club-request-queue";

// a copy of `record` without `key`
const without = <T,>(record: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** /o/[slug]/join-requests: the moderators' queue. */
export default function JoinRequestsContainer() {
  const { organisation, detail, can, approvableClubs } = useWorkspace();
  // only clubs with someone waiting get a queue; the counts refresh as requests are decided
  const [shownClubIds, setShownClubIds] = useState<string[]>([]);
  const waitingIds = approvableClubs.filter((club) => club.pendingJoinRequests > 0).map((club) => club.id);
  // keep a queue on screen until you leave, so approving the last person shows "Nobody's waiting" there
  if (waitingIds.some((id) => !shownClubIds.includes(id))) setShownClubIds([...new Set([...shownClubIds, ...waitingIds])]);
  const waitingClubs = approvableClubs.filter((club) => shownClubIds.includes(club.id));
  const orgId = organisation.orgId;
  const [tab, setTab] = useState<RequestTab>("pending");
  const requests = useJoinRequests(can.reviewJoinRequests ? orgId : undefined, tab);
  const approve = useApproveJoinRequest(orgId);
  const reject = useRejectJoinRequest(orgId);
  // per request: which button is working, and the last outcome to announce
  const [working, setWorking] = useState<Record<string, "approve" | "reject">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");

  const decide = async (request: JoinRequest, decision: "approve" | "reject") => {
    setWorking((current) => ({ ...current, [request.id]: decision }));
    setErrors((current) => without(current, request.id));
    try {
      await (decision === "approve" ? approve : reject).mutateAsync({ requestId: request.id });
      setAnnouncement(
        decision === "approve" ? `${request.name} is in. They've joined General.` : `Declined ${request.name}'s request.`,
      );
    } catch (error) {
      setErrors((current) => ({ ...current, [request.id]: workspaceErrorMessage(error) }));
    } finally {
      setWorking((current) => without(current, request.id));
    }
  };

  return (
    <JoinRequestsView
      allowed={can.reviewJoinRequests}
      canChangeSettings={can.changeSettings}
      settingsHref={`/o/${organisation.slug}/settings`}
      joinPolicy={detail?.joinPolicy ?? null}
      tab={tab}
      onTabChange={setTab}
      requests={requests.data ?? []}
      loading={requests.isPending}
      failed={requests.isError}
      onRetry={() => requests.refetch()}
      working={working}
      errors={errors}
      announcement={announcement}
      onDecide={decide}
    >
      {approvableClubs.length > 0 &&
        (waitingClubs.length > 0 ? (
          waitingClubs.map((club) => <ClubRequestQueue key={club.id} club={club} orgId={orgId} />)
        ) : (
          <section className="mt-10">
            <h2 className="text-2xl font-extrabold font-stretch-70%">Joining clubs</h2>
            <p className="mt-2 text-muted-foreground">
              Nobody&rsquo;s waiting to join a club. Requests come from invite links set to approve each person.
            </p>
          </section>
        ))}
    </JoinRequestsView>
  );
}
