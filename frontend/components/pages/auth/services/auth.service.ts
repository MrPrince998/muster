import { useQueryClient } from "@tanstack/react-query";
import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { setAccessToken } from "@/lib/auth/access-token";
import {
  AuthTokens,
  AuthUser,
  Session,
  SignInInput,
  SignUpInput,
} from "@/types";

/**
 * Signs in and keeps the access token in memory for later requests.
 * Fails with e.g. INVALID_CREDENTIALS, EMAIL_NOT_VERIFIED, TOO_MANY_REQUESTS.
 */
export const useSignIn = () =>
  useApiMutation<AuthTokens, SignInInput>(
    { method: "post", url: "/auth/signin" },
    { onSuccess: ({ accessToken }) => setAccessToken(accessToken) },
  );

/**
 * Creates the account and emails a confirmation link; sign-in is blocked
 * until it is opened. A guest who registered for events with this email
 * keeps their tickets. Fails with e.g. EMAIL_TAKEN, TOO_MANY_REQUESTS.
 */
export const useSignUp = () =>
  useApiMutation<AuthUser, SignUpInput>({
    method: "post",
    url: "/auth/signup",
  });

/**
 * Confirms an email with the token from the emailed link. Each link works
 * once. Fails with INVALID_TOKEN if it is wrong, expired (24h) or used.
 */
export const useVerifyEmail = () =>
  useApiMutation<void, { token: string }>({
    method: "post",
    url: "/auth/verify-email",
  });

/** Always succeeds for any email: the API does not reveal which addresses have accounts. */
export const useResendVerification = () =>
  useApiMutation<void, { email: string; next?: string }>({
    method: "post",
    url: "/auth/resend-verification",
  });

/** The signed-in user. Only call it behind RequireSession. */
export const useMe = () =>
  useApiQuery<AuthUser>(["auth", "me"], { url: "/auth/me" });

/**
 * Signs this device out: the API revokes the session and clears the refresh
 * cookie; here the access token and every cached response are dropped, so
 * nothing from this account is left for the next person.
 */
export const useSignOut = () => {
  const queryClient = useQueryClient();
  return useApiMutation<void, void>(
    { method: "post", url: "/auth/logout" },
    {
      onSettled: () => {
        // even if the request failed (offline), forget the session locally
        setAccessToken(null);
        queryClient.clear();
      },
    },
  );
};

/** Emails a reset link. Always succeeds: the API doesn't reveal which emails have accounts. */
export const useForgotPassword = () =>
  useApiMutation<void, { email: string }>({
    method: "post",
    url: "/auth/forgot-password",
  });

/**
 * Sets a new password with the emailed token (30 minutes, once). Signs out
 * every device. Fails with INVALID_TOKEN.
 */
export const useResetPassword = () =>
  useApiMutation<void, { token: string; password: string }>(
    { method: "post", url: "/auth/reset-password" },
    { onSuccess: () => setAccessToken(null) },
  );

/** Changes your password; every other device is signed out. Fails with INVALID_PASSWORD. */
export const useChangePassword = () =>
  useApiMutation<void, { currentPassword: string; newPassword: string }>(
    { method: "post", url: "/auth/change-password" },
    { invalidates: [SESSIONS] },
  );

/** Your name (email changes would need confirming again, so not here). */
export const useUpdateProfile = () =>
  useApiMutation<AuthUser, { name: string }>(
    { method: "patch", url: "/auth/me" },
    { invalidates: [["auth", "me"]] },
  );

const SESSIONS = ["auth", "sessions"];

/** The devices you're signed in on, this one marked `current`. */
export const useSessions = () =>
  useApiQuery<Session[]>(SESSIONS, { url: "/auth/sessions" });

/** Signs one other device out. */
export const useRevokeSession = () =>
  useApiMutation<void, { sessionId: string }>(
    ({ sessionId }) => ({
      method: "delete",
      url: `/auth/sessions/${sessionId}`,
    }),
    { invalidates: [SESSIONS] },
  );

/** Signs out every device, this one included. */
export const useSignOutEverywhere = () => {
  const queryClient = useQueryClient();
  return useApiMutation<void, void>(
    { method: "post", url: "/auth/logout-all" },
    {
      onSuccess: () => {
        setAccessToken(null);
        queryClient.clear();
      },
    },
  );
};

/** Deletes your account (DELETE /user/:id, your own id only); the password is asked again. */
export const useDeleteAccount = () => {
  const queryClient = useQueryClient();
  return useApiMutation<void, { userId: string; password: string }>(
    ({ userId, password }) => ({
      method: "delete",
      url: `/user/${userId}`,
      data: { password },
    }),
    {
      onSuccess: () => {
        setAccessToken(null);
        queryClient.clear();
      },
    },
  );
};
