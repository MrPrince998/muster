"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMyOrganisations } from "./services/organisation.service";
import WorkspaceView from "./workspace.view";

/**
 * /workspaces: with workspaces, opens the first one (the rail switches
 * between them); with none, invites them to create or join one.
 */
const WorkspaceContainer = () => {
  const router = useRouter();
  const organisations = useMyOrganisations();
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const first = organisations.data?.[0];

  useEffect(() => {
    if (first) router.replace(`/o/${first.slug}`);
  }, [first, router]);

  return (
    <WorkspaceView
      state={organisations.isError ? "failed" : organisations.isPending || first ? "loading" : "empty"}
      dialog={dialog}
      onDialogChange={setDialog}
      onRetry={() => organisations.refetch()}
    />
  );
};

export default WorkspaceContainer;
