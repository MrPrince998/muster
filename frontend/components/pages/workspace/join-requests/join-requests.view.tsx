"use client";

import { Check, Info, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { JoinPolicy, JoinRequest } from "@/types/organisation.interface";
import { formatDay, timeAgo } from "../shared/workspace-errors";
import { LoadMore } from "../shared/load-more";

export type RequestTab = "pending" | "approved" | "rejected";

const TABS: { value: RequestTab; label: string }[] = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Declined" },
];

// how people get in under each policy, when that isn't by asking
const POLICY_NOTE: Partial<Record<JoinPolicy, string>> = {
  invite: "This workspace only takes invite links, so nobody can ask to join.",
  open: "Anyone with the link joins straight away, so nobody needs to ask.",
};

interface JoinRequestsViewProps {
  allowed: boolean;
  canChangeSettings: boolean;
  settingsHref: string;
  joinPolicy: JoinPolicy | null;
  tab: RequestTab;
  onTabChange: (tab: RequestTab) => void;
  requests: JoinRequest[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  working: Record<string, "approve" | "reject">;
  errors: Record<string, string>;
  announcement: string;
  onDecide: (request: JoinRequest, decision: "approve" | "reject") => void;
}

/** People asking to join, and what was decided before. Presentational. */
const JoinRequestsView = (props: JoinRequestsViewProps) => {
  const {
    allowed,
    canChangeSettings,
    settingsHref,
    joinPolicy,
    tab,
    onTabChange,
    requests,
    loading,
    failed,
    onRetry,
  } = props;

  if (!allowed) {
    return (
      <section className="max-w-xl px-5 py-6 sm:px-8 lg:py-8">
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">
          Join requests
        </h1>
        <p className="mt-3 text-muted-foreground">
          Moderators and admins review who gets into the workspace. People
          waiting to join a club are in that club&rsquo;s settings.
        </p>
      </section>
    );
  }

  const policyNote = joinPolicy ? POLICY_NOTE[joinPolicy] : undefined;

  return (
    <section className="w-full max-w-3xl px-5 py-6 sm:px-8 lg:py-8">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">
        Join requests
      </h1>
      {allowed && (
        <>
          <h2 className="mt-8 text-2xl font-extrabold font-stretch-70%">
            Joining the workspace
          </h2>
          <p className="mt-2 text-muted-foreground">
            Approving someone adds them to the workspace and its General club.
            Declined people can ask again after a day.
          </p>

          {policyNote && (
            <p className="mt-5 flex gap-2.5 rounded-xl bg-cobalt-50 p-4 text-sm text-cobalt-800">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {policyNote}{" "}
                {canChangeSettings ? (
                  <>
                    To review people first, set{" "}
                    <Link
                      href={settingsHref}
                      className="font-semibold underline underline-offset-4"
                    >
                      who can join
                    </Link>{" "}
                    to &ldquo;Ask to join&rdquo;.
                  </>
                ) : (
                  "An admin can change that in settings."
                )}
              </span>
            </p>
          )}

          <Tabs
            value={tab}
            onValueChange={(value) => onTabChange(value as RequestTab)}
            className="mt-6"
          >
            <TabsList variant="line" className="h-10 gap-4 border-b p-0">
              {TABS.map(({ value, label }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex-none px-0 text-[15px] data-active:text-cobalt-800"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* announces each decision for screen readers */}
          <p className="sr-only" role="status">
            {props.announcement}
          </p>

          <div className="mt-6">
            {loading ? (
              <ul className="space-y-3" aria-hidden>
                {[0, 1].map((i) => (
                  <li
                    key={i}
                    className="h-28 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none"
                  />
                ))}
              </ul>
            ) : failed ? (
              <div className="rounded-xl border border-dashed p-8">
                <p className="text-xl font-bold font-stretch-80%">
                  Couldn&rsquo;t load the requests
                </p>
                <p className="mt-1 text-muted-foreground">
                  Check your connection, then try again.
                </p>
                <Button className="mt-4" variant="outline" onClick={onRetry}>
                  Try again
                </Button>
              </div>
            ) : requests.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8">
                <p className="text-xl font-bold font-stretch-80%">
                  {tab === "pending"
                    ? "Nobody's waiting"
                    : tab === "approved"
                      ? "No approvals yet"
                      : "Nothing declined"}
                </p>
                {tab === "pending" && (
                  <p className="mt-1 text-muted-foreground">
                    New requests show up here, oldest first.
                  </p>
                )}
              </div>
            ) : (
              <>
                <ul className="space-y-3">
                  {requests.map((request) => (
                    <RequestCard key={request.id} request={request} {...props} />
                  ))}
                </ul>
                {props.hasMore && (
                  <LoadMore
                    shown={requests.length}
                    total={props.total}
                    loading={props.loadingMore}
                    onMore={props.onMore}
                  />
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
};

function RequestCard({
  request,
  tab,
  working,
  errors,
  onDecide,
}: JoinRequestsViewProps & { request: JoinRequest }) {
  const busy = working[request.id];
  return (
    <li className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold">{request.name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {request.email}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {tab === "pending"
            ? `Asked ${timeAgo(request.createdAt)}`
            : request.decidedAt
              ? formatDay(request.decidedAt)
              : ""}
        </p>
      </div>

      {request.message && (
        <blockquote className="mt-3 border-l-2 border-cobalt-200 pl-3 text-sm whitespace-pre-line">
          {request.message}
        </blockquote>
      )}

      {errors[request.id] && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errors[request.id]}
        </p>
      )}

      {tab === "pending" && (
        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => onDecide(request, "approve")}
            disabled={!!busy}
          >
            {busy === "approve" ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Check aria-hidden />
            )}
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button
            variant="outline"
            onClick={() => onDecide(request, "reject")}
            disabled={!!busy}
          >
            {busy === "reject" ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <X aria-hidden />
            )}
            {busy === "reject" ? "Declining…" : "Decline"}
          </Button>
        </div>
      )}
    </li>
  );
}

export default JoinRequestsView;
