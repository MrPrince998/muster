"use client";

import { Link2, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import CreateWorkspaceDialog from "./dialogs/create-workspace-dialog";
import JoinWorkspaceDialog from "./dialogs/join-workspace-dialog";

interface WorkspaceViewProps {
  state: "loading" | "empty" | "failed";
  dialog: "create" | "join" | null;
  onDialogChange: (dialog: "create" | "join" | null) => void;
  onRetry: () => void;
}

/** /workspaces before a workspace opens: loading, or a first-run invitation. Presentational. */
const WorkspaceView = ({ state, dialog, onDialogChange, onRetry }: WorkspaceViewProps) => {
  if (state === "loading") {
    return (
      <div className="flex justify-center py-24" role="status">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Opening your workspace</span>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <section className="mx-auto max-w-xl space-y-4 px-6 py-24">
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">
          Couldn&rsquo;t load your workspaces
        </h1>
        <p className="text-muted-foreground">Check your connection, then try again.</p>
        <Button onClick={onRetry}>Try again</Button>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-xl px-6 py-24">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Start with a workspace</h1>
      <p className="mt-4 max-w-prose text-muted-foreground">
        A workspace is home for your university, company or community. Its clubs, events and
        members live there, and it shows up in the rail on the left.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button size="lg" className="h-11 px-5 text-[15px] font-semibold" onClick={() => onDialogChange("create")}>
          <Plus aria-hidden />
          Create a workspace
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-11 px-5 text-[15px]"
          onClick={() => onDialogChange("join")}
        >
          <Link2 aria-hidden />
          Join with a link
        </Button>
      </div>

      <CreateWorkspaceDialog open={dialog === "create"} onOpenChange={(open) => !open && onDialogChange(null)} />
      <JoinWorkspaceDialog open={dialog === "join"} onOpenChange={(open) => !open && onDialogChange(null)} />
    </section>
  );
};

export default WorkspaceView;
