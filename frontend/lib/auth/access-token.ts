/**
 * The access token lives only in memory: unlike localStorage, a malicious
 * script cannot read it from storage, and it disappears when the tab
 * closes. After a reload, POST /auth/refresh (using the httpOnly cookie)
 * issues a new one; the API client does that automatically on a 401.
 */
let accessToken: string | null = null;
const tokenListeners = new Set<() => void>();

export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  if (token === accessToken) return;
  accessToken = token;
  tokenListeners.forEach((listener) => listener());
};

/** Subscribe to the token changing (for useSyncExternalStore); returns the unsubscribe. */
export function subscribeToAccessToken(listener: () => void) {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

// --- session end -------------------------------------------------------------
// Fired when a signed-in session stops working (signed out elsewhere, refresh
// token expired or revoked), so the app can clear its data and go to sign in.

type SessionEndListener = () => void;
const sessionEndListeners = new Set<SessionEndListener>();

/** Subscribe to the session ending; returns the unsubscribe function. */
export function onSessionEnd(listener: SessionEndListener) {
  sessionEndListeners.add(listener);
  return () => {
    sessionEndListeners.delete(listener);
  };
}

/** Forgets the token and tells the listeners. */
export function endSession() {
  setAccessToken(null);
  sessionEndListeners.forEach((listener) => listener());
}
