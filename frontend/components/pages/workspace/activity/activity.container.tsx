"use client";

import { useState } from "react";
import { useWorkspace } from "../org-shell/workspace-context";
import { useAuditLog } from "../services/audit.service";
import ActivityView from "./activity.view";

/** /o/[slug]/activity: who changed what in the workspace (owner and admins). */
export default function ActivityContainer() {
  const { organisation, clubs, can } = useWorkspace();
  const [clubId, setClubId] = useState<string | null>(null);
  const log = useAuditLog(organisation.orgId, clubId);

  return (
    <ActivityView
      allowed={can.changeSettings}
      timeZone={organisation.timeZone}
      clubs={clubs.data}
      clubId={clubId}
      onClubChange={setClubId}
      entries={log.data?.pages.flatMap((page) => page.entries) ?? []}
      loading={log.isPending}
      failed={log.isError}
      onRetry={() => log.refetch()}
      hasMore={log.hasNextPage}
      loadingMore={log.isFetchingNextPage}
      onMore={() => log.fetchNextPage()}
    />
  );
}
