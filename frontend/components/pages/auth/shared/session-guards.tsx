"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { type SessionStatus, useSession } from "@/lib/auth/useSession";

// where each side of the guard sends people
export const HOME = "/workspaces";
export const SIGN_IN = "/login";

/**
 * Where to go after signing in: the page in ?next= (set when a signed-out
 * visitor was sent to sign in, e.g. from an invite link), else home. Only
 * paths on this site, so a crafted link can't send people elsewhere.
 */
export function afterSignIn(): string {
  return nextPath() ?? HOME;
}

/** The page in ?next=, if it's a path on this site (same rule as the API's). */
export function nextPath(): string | null {
  return safeNext(new URLSearchParams(window.location.search).get("next"));
}

/** `value` if it's a path on this site, else null. Works on the server too. */
export function safeNext(value: string | null): string | null {
  return value && /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/.test(value) ? value : null;
}

/** `path`, carrying ?next= along when there is one (sign in <-> sign up). */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

/** Whether a next page is an invite link, to say so on the auth screens. */
export const isInvite = (next: string | null) => !!next?.startsWith("/join/");

// sign in, then come back to this page
const signInHere = () =>
  `${SIGN_IN}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

/**
 * For sign-in and sign-up: someone already signed in goes home (or to ?next=) instead.
 * Nothing renders until the session is known, so the form never flashes.
 */
export function GuestOnly({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate allow="signed-out" redirectTo={afterSignIn}>
      {children}
    </SessionGate>
  );
}

/** For pages that need an account: anyone signed out goes to sign in, and comes back after. */
export function RequireSession({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate allow="signed-in" redirectTo={signInHere}>
      {children}
    </SessionGate>
  );
}

function SessionGate({
  allow,
  redirectTo,
  children,
}: {
  allow: Exclude<SessionStatus, "checking">;
  // worked out when redirecting: it reads the current URL
  redirectTo: () => string;
  children: React.ReactNode;
}) {
  const status = useSession();
  const router = useRouter();
  const redirecting = status !== "checking" && status !== allow;

  useEffect(() => {
    if (redirecting) router.replace(redirectTo());
  }, [redirecting, redirectTo, router]);

  if (status === allow) return children;
  return <SessionCheck />;
}

function SessionCheck() {
  return (
    <div className="flex justify-center py-16" role="status">
      <LoaderCircle
        className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden
      />
      <span className="sr-only">Checking your session</span>
    </div>
  );
}
