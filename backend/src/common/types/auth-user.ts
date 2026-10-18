/**
 * The authenticated user, as attached to the request by the auth guard.
 * Kept minimal: anything else is looked up when needed, so a stale token
 * can never carry stale permissions.
 */
export interface AuthUser {
  id: string;
  // the session (device) the access token belongs to
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
