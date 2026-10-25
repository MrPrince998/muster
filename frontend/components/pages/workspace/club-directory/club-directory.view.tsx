"use client";

import { CalendarDays, Check, Clock, Link2, LoaderCircle, Send, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ClubDirectoryEntry } from "@/types";
import { ConfirmDialog } from "../shared/confirm-dialog";

export interface ClubDirectoryViewProps {
  workspaceName: string;
  clubs: ClubDirectoryEntry[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  clubHref: (clubId: string) => string;
  // the club's own link, to share with people who aren't in it
  linkFor: (club: ClubDirectoryEntry) => string;
  // the club a button is working on, and the last error per club
  working: string | null;
  errors: Record<string, string>;
  announcement: string;
  onJoin: (club: ClubDirectoryEntry) => void;
  onCancelRequest: (club: ClubDirectoryEntry) => void;
  // asking: the club whose "ask to join" dialog is open, and the note being written
  asking: ClubDirectoryEntry | null;
  onAskingChange: (club: ClubDirectoryEntry | null) => void;
  message: string;
  onMessageChange: (message: string) => void;
  onAsk: () => Promise<string | null>;
}

/** /o/[slug]/clubs: every club you can find in the workspace, and a way into each. Presentational. */
const ClubDirectoryView = (props: ClubDirectoryViewProps) => {
  const { workspaceName, clubs, loading, failed, onRetry, announcement } = props;
  const others = clubs.filter((club) => !club.isMember);
  const mine = clubs.filter((club) => club.isMember);

  return (
    <section className="w-full max-w-3xl px-5 py-6 sm:px-8 lg:py-8">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Clubs</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Clubs in {workspaceName} that you can join without an invite. Clubs that take invite links only don&rsquo;t
        show here. Copy a club&rsquo;s link to share it with people who aren&rsquo;t in the workspace yet.
      </p>
      <p className="sr-only" role="status">
        {announcement}
      </p>

      {loading ? (
        <div className="mt-8 space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
          ))}
        </div>
      ) : failed ? (
        <div className="mt-8 space-y-3">
          <p className="text-muted-foreground">Couldn&rsquo;t load the clubs.</p>
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <h2 className="mt-10 text-2xl font-extrabold font-stretch-70%">Clubs you can join</h2>
          {others.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed p-6 text-muted-foreground">
              You&rsquo;re in every club that takes people without an invite. To join another, ask someone in it for
              an invite link.
            </p>
          ) : (
            <ul className="mt-4 divide-y rounded-xl border">
              {others.map((club) => (
                <ClubRow key={club.id} club={club} {...props} />
              ))}
            </ul>
          )}

          {mine.length > 0 && (
            <>
              <h2 className="mt-12 text-2xl font-extrabold font-stretch-70%">Your clubs</h2>
              <ul className="mt-4 divide-y rounded-xl border">
                {mine.map((club) => (
                  <ClubRow key={club.id} club={club} {...props} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!props.asking}
        onOpenChange={(open) => !open && props.onAskingChange(null)}
        title={`Ask to join ${props.asking?.name ?? "the club"}?`}
        body="The people who approve members in the club decide. You'll see the club in your list once they let you in."
        confirmLabel="Send request"
        pendingLabel="Sending…"
        onConfirm={props.onAsk}
      >
        <Field>
          <FieldLabel htmlFor="join-message">Note (optional)</FieldLabel>
          <Textarea
            id="join-message"
            rows={3}
            maxLength={500}
            value={props.message}
            placeholder="Why you'd like to join"
            onChange={(event) => props.onMessageChange(event.target.value)}
          />
          <FieldDescription>Only the people deciding see it.</FieldDescription>
        </Field>
      </ConfirmDialog>
    </section>
  );
};

function ClubRow({
  club,
  clubHref,
  linkFor,
  working,
  errors,
  onJoin,
  onCancelRequest,
  onAskingChange,
}: ClubDirectoryViewProps & { club: ClubDirectoryEntry }) {
  const busy = working === club.id;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-semibold">{club.name}</p>
        {club.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{club.description}</p>}
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4" aria-hidden />
            {club.memberCount} {club.memberCount === 1 ? "member" : "members"}
          </span>
          {club.upcomingCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden />
              {club.upcomingCount} upcoming
            </span>
          )}
          {!club.isMember && club.joinPolicy === "request" && !club.requested && <span>Asks before letting people in</span>}
        </p>
        {errors[club.id] && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {errors[club.id]}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {club.isMember ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="size-4 text-cobalt" aria-hidden />
              You&rsquo;re in
            </span>
            <Link href={clubHref(club.id)} className={cn(buttonVariants({ variant: "outline" }))}>
              Events
            </Link>
          </>
        ) : club.requested ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden />
              Requested
            </span>
            <Button variant="ghost" onClick={() => onCancelRequest(club)} disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden />}
              Take back
            </Button>
          </>
        ) : club.joinPolicy === "open" ? (
          <Button onClick={() => onJoin(club)} disabled={busy} aria-label={`Join ${club.name}`}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
            {busy ? "Joining…" : "Join"}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => onAskingChange(club)} aria-label={`Ask to join ${club.name}`}>
            <Send aria-hidden />
            Ask to join
          </Button>
        )}
        {club.joinPolicy !== "invite" && <CopyClubLink url={linkFor(club)} clubName={club.name} />}
      </div>
    </li>
  );
}

/** Copies the club's own link, for sharing with people who aren't in it yet. */
export function CopyClubLink({ url, clubName }: { url: string; clubName: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (insecure origin, permissions): nothing to copy by hand here, so stay quiet
    }
  };
  return (
    <Button variant="ghost" onClick={copy} aria-label={`Copy ${clubName}'s link`} aria-live="polite">
      {copied ? <Check aria-hidden /> : <Link2 aria-hidden />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export default ClubDirectoryView;
