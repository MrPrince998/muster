"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { refreshSession } from "@/lib/api/client";
import { getAccessToken, subscribeToAccessToken } from "./access-token";

export type SessionStatus = "checking" | "signed-in" | "signed-out";

/**
 * Whether someone is signed in, read live from the in-memory access token:
 * it changes the moment they sign in or out, in every mounted page.
 *
 * Reading it live matters because Next keeps pages you left alive in the
 * background (for back/forward). A remembered "signed out" from before
 * signing in would bounce them straight back to sign in when that page
 * returns; the token can't be stale.
 *
 * No token (after a reload it is gone) means one POST /auth/refresh with the
 * httpOnly cookie decides. The API being unreachable counts as signed out:
 * the sign-in page says what is wrong when they try.
 */
export function useSession(): SessionStatus {
  // the server never has a token, so the first render matches on hydration
  const token = useSyncExternalStore(subscribeToAccessToken, getAccessToken, () => null);
  // the refresh's answer when there was no token; a new token outranks it
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    if (token || noSession) return;
    let cancelled = false;
    refreshSession()
      // a token updates the store above; null means there is no session
      .then((fresh) => !cancelled && !fresh && setNoSession(true))
      .catch(() => !cancelled && setNoSession(true));
    return () => {
      cancelled = true;
    };
  }, [token, noSession]);

  if (token) return "signed-in";
  return noSession ? "signed-out" : "checking";
}
