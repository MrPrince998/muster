"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InvitePreview, InviteStatus } from "@/types/invite.interface";

const DEAD: Record<Exclude<InviteStatus, "active">, string> = {
  expired: "This invite has expired",
  used_up: "This invite has been used up",
  revoked: "This invite was turned off",
};

interface JoinInviteViewProps {
  preview: InvitePreview | null;
  loading: boolean;
  notFound: boolean;
  failed: boolean;
  onRetry: () => void;
  joining: boolean;
  // asked through a link that needs approval: waiting to be let in
  waiting: boolean;
  error: string | null;
  onJoin: () => void;
  onOpen: () => void;
}

// The invite as an admission ticket: what it's for on the stub, the action
// beside it. The same notched ticket as the events.
const notches = [
  "radial-gradient(circle 0.7rem at 0 var(--tear), transparent 98%, #000) left / 51% 100% no-repeat",
  "radial-gradient(circle 0.7rem at 100% var(--tear), transparent 98%, #000) right / 51% 100% no-repeat",
].join(", ");

/** Where an invite link leads, and the one button to get in. Presentational. */
const JoinInviteView = ({
  preview,
  loading,
  notFound,
  failed,
  onRetry,
  joining,
  waiting,
  error,
  onJoin,
  onOpen,
}: JoinInviteViewProps) => {
  if (loading) {
    return (
      <Centered>
        <div className="flex justify-center py-16" role="status">
          <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
          <span className="sr-only">Opening the invite</span>
        </div>
      </Centered>
    );
  }

  if (notFound || failed || !preview) {
    return (
      <Centered>
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">
          {failed ? "Couldn't open this invite" : "This invite link doesn't work"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {failed
            ? "Check your connection, then try again."
            : "Check you have the whole link, or ask whoever sent it for a new one."}
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

  const target = preview.clubIsDefault ? preview.workspaceName : preview.clubName;

  if (preview.alreadyMember) {
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

  if (waiting) {
    return (
      <Centered>
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">Request sent</h1>
        <p className="mt-3 text-muted-foreground">
          Someone in {target} who can approve requests will review it. Once they let you in, {target} shows up in your
          workspaces{preview.roleName ? `, with the ${preview.roleName} role` : ""}.
        </p>
        <GoHome />
      </Centered>
    );
  }

  if (preview.status !== "active") {
    return (
      <Centered>
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">{DEAD[preview.status]}</h1>
        <p className="mt-3 text-muted-foreground">
          It was for {target}. Ask whoever sent it for a new link.
        </p>
        <GoHome />
      </Centered>
    );
  }

  return (
    <Centered>
      <p className="text-sm text-muted-foreground">You&rsquo;re invited</p>
      <div
        style={{ mask: notches, WebkitMask: notches, "--tear": "8.5rem" } as React.CSSProperties}
        className="mt-3 overflow-hidden rounded-2xl bg-cobalt text-white"
      >
        <div className="h-[8.5rem] p-6">
          <p className="text-sm text-white/75">{preview.clubIsDefault ? "Workspace" : preview.workspaceName}</p>
          <h1 className="mt-1 text-4xl leading-none font-extrabold font-stretch-70%">{target}</h1>
          <p className="mt-2 text-sm text-white/85">
            {preview.roleName ? `You'll join as ${preview.roleName}.` : "You'll join as a member."}
          </p>
        </div>
        <div className="mx-6 border-t-2 border-dashed border-white/30" />
        <div className="p-6 pt-5">
          <p className="text-sm text-white/85">
            {preview.requiresApproval
              ? "Someone approves each person, so you'll ask first and get in once they say yes."
              : preview.clubIsDefault
                ? "You'll see its clubs and events, and can register for them."
                : `You'll also join ${preview.workspaceName} and its General club.`}
          </p>
          <Button
            size="lg"
            onClick={onJoin}
            disabled={joining}
            className="mt-4 h-11 w-full bg-white font-semibold text-cobalt-800 hover:bg-cobalt-50"
          >
            {joining && <LoaderCircle className="animate-spin" aria-hidden />}
            {joining
              ? preview.requiresApproval
                ? "Asking…"
                : "Joining…"
              : preview.requiresApproval
                ? `Ask to join ${target}`
                : `Join ${target}`}
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

export default JoinInviteView;
