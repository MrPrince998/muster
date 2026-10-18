"use client";

import { LoaderCircle, Monitor, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";
import {
  useRevokeSession,
  useSessions,
  useSignOutEverywhere,
} from "../../auth/services/auth.service";
import { ConfirmDialog } from "../../workspace/shared/confirm-dialog";
import {
  formatDay,
  timeAgo,
  workspaceErrorMessage,
} from "../../workspace/shared/workspace-errors";
import { AccountRow } from "./account-row";

/** "Chrome on macOS", from a user-agent string; good enough to recognise your own devices. */
export function describeDevice(userAgent: string | null): {
  label: string;
  phone: boolean;
} {
  if (!userAgent) return { label: "Unknown device", phone: false };
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : /node|curl|axios/i.test(userAgent)
              ? "An app or script"
              : "A browser";
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return {
    label: os ? `${browser} on ${os}` : browser,
    phone: /iPhone|Android|Mobile/.test(userAgent),
  };
}

/** Where you're signed in: sign out a lost phone, or everywhere at once. */
export function DevicesSection() {
  const router = useRouter();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const everywhere = useSignOutEverywhere();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  // this device first, then the most recently active
  const list = [...(sessions.data ?? [])].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      b.lastUsedAt.localeCompare(a.lastUsedAt),
  );

  const signOut = async (session: Session) => {
    setRevoking(session.id);
    setError(null);
    try {
      await revoke.mutateAsync({ sessionId: session.id });
    } catch (failure) {
      setError(workspaceErrorMessage(failure));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <AccountRow
      id="devices-heading"
      title="Signed-in devices"
      description="Don’t recognise one? Sign it out, then change your password."
      aside={
        <Button
          variant="outline"
          className="h-10 px-3.5"
          onClick={() => setConfirmingAll(true)}
          disabled={!sessions.data}
        >
          Sign out everywhere
        </Button>
      }
    >
      <div>
        {sessions.isPending ? (
          <div
            className="h-32 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none"
            aria-hidden
          />
        ) : sessions.isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn&rsquo;t load your devices.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {list.map((session) => {
              const { label, phone } = describeDevice(session.userAgent);
              const Icon = phone ? Smartphone : Monitor;
              return (
                <li key={session.id} className="flex items-start gap-3.5 p-4">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
                    aria-hidden
                  >
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                      {label}
                      {session.current && (
                        <span className="rounded-full bg-cobalt-50 px-2 py-0.5 text-xs font-semibold text-cobalt-800">
                          This device
                        </span>
                      )}
                    </p>
                    <p
                      className={cn(
                        "text-sm",
                        session.current
                          ? "font-medium text-cobalt-700"
                          : "text-muted-foreground",
                      )}
                    >
                      {session.current
                        ? "Active now"
                        : `Last active ${timeAgo(session.lastUsedAt)}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Signed in {formatDay(session.createdAt)}
                      {session.ip
                        ? ` from ${session.ip.replace(/^::ffff:/, "")}`
                        : ""}
                    </p>
                  </div>
                  {!session.current && (
                    <Button
                      variant="ghost"
                      className="-my-1 h-9 shrink-0"
                      aria-label={`Sign out ${label}`}
                      onClick={() => signOut(session)}
                      disabled={revoking === session.id}
                    >
                      {revoking === session.id && (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      )}
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmingAll}
        onOpenChange={setConfirmingAll}
        title="Sign out everywhere?"
        body="Every device signs out, this one too. You'll need your password to sign back in."
        confirmLabel="Sign out everywhere"
        pendingLabel="Signing out…"
        destructive
        onConfirm={async () => {
          try {
            await everywhere.mutateAsync();
            router.replace("/login");
            return null;
          } catch (failure) {
            return workspaceErrorMessage(failure);
          }
        }}
      />
    </AccountRow>
  );
}
