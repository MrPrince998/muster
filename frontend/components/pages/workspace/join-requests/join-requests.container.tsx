"use client";

import { useState } from "react";
import type { JoinRequest } from "@/types/organisation.interface";
import { useWorkspace } from "../org-shell/workspace-context";
import { useApproveJoinRequest, useJoinRequests, useRejectJoinRequest } from "../services/member.service";
import { workspaceErrorMessage } from "../shared/workspace-errors";
import JoinRequestsView, { type RequestTab } from "./join-requests.view";

// a copy of `record` without `key`
const without = <T,>(record: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** /o/[slug]/join-requests: the moderators' queue for joining the workspace. Clubs keep their own, in club settings. */
export default function JoinRequestsContainer() {
  const { organisation, detail, can } = useWorkspace();
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
      requests={requests.data?.pages.flatMap((page) => page.requests) ?? []}
      total={requests.data?.pages[0]?.total ?? 0}
      hasMore={requests.hasNextPage}
      loadingMore={requests.isFetchingNextPage}
      onMore={() => requests.fetchNextPage()}
      loading={requests.isPending}
      failed={requests.isError}
      onRetry={() => requests.refetch()}
      working={working}
      errors={errors}
      announcement={announcement}
      onDecide={decide}
    />
  );
}
