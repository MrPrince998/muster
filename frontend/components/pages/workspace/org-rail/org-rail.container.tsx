"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import CreateWorkspaceDialog from "../dialogs/create-workspace-dialog";
import JoinWorkspaceDialog from "../dialogs/join-workspace-dialog";
import { useMyOrganisations } from "../services/organisation.service";
import OrgRailView from "./org-rail.view";

/** Data and dialogs for the workspace rail; the view only renders. */
export default function OrgRailContainer() {
  // the open workspace, from /o/[slug]; none on /workspaces
  const params = useParams<{ slug?: string }>();
  const organisations = useMyOrganisations();
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);

  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <OrgRailView
        organisations={organisations.data ?? []}
        loading={organisations.isPending}
        failed={organisations.isError}
        activeSlug={params.slug ?? null}
        onRetry={() => organisations.refetch()}
        onCreate={() => setDialog("create")}
        onJoin={() => setDialog("join")}
      />
      <CreateWorkspaceDialog open={dialog === "create"} onOpenChange={closeDialog} />
      <JoinWorkspaceDialog open={dialog === "join"} onOpenChange={closeDialog} />
    </>
  );
}
