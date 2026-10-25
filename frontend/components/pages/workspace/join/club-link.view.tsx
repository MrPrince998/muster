"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ClubLinkPreview } from "@/types";

interface ClubLinkViewProps {
  preview: ClubLinkPreview | null;
  loading: boolean;
  notFound: boolean;
  failed: boolean;
  onRetry: () => void;
  joining: boolean;
  // what they just asked for, if anything
  sent: "club" | "workspace" | null;
  message: string;
  onMessageChange: (message: string) => void;
  error: string | null;
  onJoin: () => void;
  onOpen: () => void;
}

// the same notched ticket as an invite link
const notches = [
  "radial-gradient(circle 0.7rem at 0 var(--tear), transparent 98%, #000) left / 51% 100% no-repeat",
  "radial-gradient(circle 0.7rem at 100% var(--tear), transparent 98%, #000) right / 51% 100% no-repeat",
].join(", ");

/** What joining through this link does, given both join settings. */
function plan(preview: ClubLinkPreview): { asks: "club" | "workspace" | null; button: string; note: string } {
  const club = preview.clubName;
  const workspace = preview.workspaceName;
  if (!preview.inWorkspace && preview.workspaceJoinPolicy === "request") {
    return {
      asks: "workspace",
      button: `Ask to join ${workspace}`,
      note: preview.isDefault
        ? `${workspace} reviews new people first. Its moderators decide.`
        : `${workspace} reviews new people first. Once you're in, open this link again to join ${club}.`,
    };
  }
  if (preview.isDefault) {
    return { asks: null, button: `Join ${workspace}`, note: "You'll see its clubs and events, and can register for them." };
  }
  if (preview.joinPolicy === "request") {
    return {
      asks: "club",
      button: `Ask to join ${club}`,
      note: preview.inWorkspace
        ? `The people who approve members in ${club} decide.`
        : `The people who approve members in ${club} decide. If they say yes, you'll join ${workspace} too.`,
    };
  }
  return {
    asks: null,
    button: `Join ${club}`,
    note: preview.inWorkspace
      ? "You'll see its events, and can register for them."
      : `You'll also join ${workspace} and its General club.`,
  };
}

/** Where a club's own link leads, and the one button to get in. Presentational. */
const ClubLinkView = (props: ClubLinkViewProps) => {
  const { preview, loading, notFound, failed, onRetry, joining, sent, error, onJoin, onOpen } = props;

  if (loading) {
    return (
      <Centered>
        <div className="flex justify-center py-16" role="status">
          <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
          <span className="sr-only">Opening the club</span>
        </div>
      </Centered>
    );
  }

  if (notFound || failed || !preview) {
    return (
      <Centered>
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">
          {failed ? "Couldn't open this club" : "This club link doesn't work"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {failed
            ? "Check your connection, then try again."
            : "The club may take invite links only, or the link changed. Ask someone in it for an invite link."}
        </p>
        {failed ? (
          <Button className="mt-6" onClick={onRetry}>
            Try again
          </Button>
        ) : (
          <GoHome />
        )}
      </Centered>
    );
  }

  const target = preview.isDefault ? preview.workspaceName : preview.clubName;

  if (preview.isMember) {
    return (
      <Centered>
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">You&rsquo;re already in {target}</h1>
        <p className="mt-3 text-muted-foreground">Nothing to do: the link would only bring you somewhere you already are.</p>
        <Button className="mt-6" onClick={onOpen}>
          Open {target}
        </Button>
      </Centered>
    );
  }

  const waitingOn = sent ?? (preview.requested ? "club" : !preview.inWorkspace && preview.workspaceRequested ? "workspace" : null);
  if (waitingOn) {
    return (
      <Centered>
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">Request sent</h1>
        <p className="mt-3 text-muted-foreground">
          {waitingOn === "workspace"
            ? `${preview.workspaceName}'s moderators will review it. Once you're in, ${
                preview.isDefault ? "it shows up in your workspaces." : `open this link again to join ${preview.clubName}.`
              }`
            : `Someone in ${preview.clubName} who can approve members will review it. Once they let you in, it shows up in your clubs.`}
        </p>
        <GoHome />
      </Centered>
    );
  }

  const { asks, button, note } = plan(preview);

  return (
    <Centered>
      <p className="text-sm text-muted-foreground">{preview.isDefault ? "A workspace on Muster" : "A club on Muster"}</p>
      <div
        style={{ mask: notches, WebkitMask: notches, "--tear": "8.5rem" } as React.CSSProperties}
        className="mt-3 overflow-hidden rounded-2xl bg-cobalt text-white"
      >
        <div className="h-[8.5rem] p-6">
          <p className="text-sm text-white/75">{preview.isDefault ? "Workspace" : preview.workspaceName}</p>
          <h1 className="mt-1 line-clamp-1 text-4xl leading-none font-extrabold font-stretch-70%">{target}</h1>
          <p className="mt-2 line-clamp-2 text-sm text-white/85">
            {preview.description ??
              `${preview.memberCount} ${preview.memberCount === 1 ? "member" : "members"}.`}
          </p>
        </div>
        <div className="mx-6 border-t-2 border-dashed border-white/30" />
        <div className="p-6 pt-5">
          <p className="text-sm text-white/85">{note}</p>
          {asks && (
            <label className="mt-4 block text-sm">
              <span className="text-white/85">A note for them (optional)</span>
              <Textarea
                rows={2}
                maxLength={500}
                value={props.message}
                onChange={(event) => props.onMessageChange(event.target.value)}
                placeholder="Why you'd like to join"
                className="mt-1.5 border-white/30 bg-white/10 text-white placeholder:text-white/50"
              />
            </label>
          )}
          <Button
            size="lg"
            onClick={onJoin}
            disabled={joining}
            className="mt-4 h-11 w-full bg-white font-semibold text-cobalt-800 hover:bg-cobalt-50"
          >
            {joining && <LoaderCircle className="animate-spin" aria-hidden />}
            {joining ? (asks ? "Asking…" : "Joining…") : button}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </Centered>
  );
};

function Centered({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto w-full max-w-md px-5 py-16">{children}</section>;
}

function GoHome() {
  return (
    <Link href="/workspaces" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-6 h-11 border-cobalt-200 px-5")}>
      Go to your workspaces
    </Link>
  );
}

export default ClubLinkView;
