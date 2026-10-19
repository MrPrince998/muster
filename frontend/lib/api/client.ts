import axios, {
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
  isAxiosError,
} from "axios";
import {
  endSession,
  getAccessToken,
  setAccessToken,
} from "@/lib/auth/access-token";

const apiConfig = {
  baseURL: process.env.NEXT_PUBLIC_API_URL!,
  // sends and receives the httpOnly refresh token cookie, which the browser
  // keeps; page scripts never see it
  withCredentials: true,
  timeout: 15_000,
};

/** The backend API: adds the access token, and refreshes it on a 401. */
export const api = axios.create(apiConfig);

// Only for POST /auth/refresh: no interceptors, so a failed refresh can
// never trigger another refresh.
const refreshClient = axios.create(apiConfig);

// every request carries the in-memory access token once signed in
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// --- automatic refresh ---------------------------------------------------------
//
// A 401 with one of these codes means "no usable access token": expired, or
// none yet because the page was reloaded. A new one from POST /auth/refresh
// fixes it, so get one and send the request again, once. Other 401s
// (INVALID_CREDENTIALS from sign-in, ...) are real answers and pass through.
const REFRESHABLE = new Set(["UNAUTHENTICATED", "INVALID_TOKEN"]);

// Refresh tokens work once, and the API treats a reused one as stolen and
// signs the device out. So refreshes never overlap: within this tab, every
// caller shares the one in flight; across tabs, a Web Lock queues them, so
// each tab sends the cookie the previous refresh just set.
let refreshing: Promise<string | null> | null = null;

const acrossTabs = (
  run: () => Promise<string | null>,
): Promise<string | null> =>
  typeof navigator !== "undefined" && navigator.locks
    ? // the lock resolves with what `run` resolves with; TypeScript's DOM
      // types say Promise<Promise<...>>, which is not what browsers do
      (navigator.locks.request(
        "muster:auth-refresh",
        run,
      ) as unknown as Promise<string | null>)
    : run();

/**
 * Gets a new access token with the refresh cookie. Resolves with the token,
 * or null when there is no session to refresh (never signed in, expired,
 * revoked). Rejects only if the API can't be reached; the session is kept.
 */
export function refreshSession(): Promise<string | null> {
  refreshing ??= acrossTabs(async () => {
    const hadSession = getAccessToken() !== null;
    try {
      const { data } = await refreshClient.post<{ accessToken: string }>(
        "/auth/refresh",
      );
      setAccessToken(data.accessToken);
      return data.accessToken;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        // a session that was working has ended; someone who simply isn't
        // signed in (a reload on a public page) is not news
        if (hadSession) endSession();
        else setAccessToken(null);
        return null;
      }
      throw error;
    }
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(undefined, async (error: unknown) => {
  if (!isAxiosError(error) || error.response?.status !== 401 || !error.config)
    throw error;
  const config = error.config as RetriableConfig;
  const code = (error.response.data as { code?: string } | undefined)?.code;

  // signed out on the server ("log out everywhere", password reset):
  // refreshing would fail too
  if (code === "SESSION_ENDED") {
    endSession();
    throw error;
  }
  if (!code || !REFRESHABLE.has(code) || config._retried) throw error;

  config._retried = true;
  const token = await refreshSession();
  if (!token) throw error; // no session: the original 401 stands
  return api.request(config); // the request interceptor adds the new token
});

/** Every error the API returns has this shape; branch on `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Normalises anything a request can throw into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (isAxiosError(error)) {
    const body = error.response?.data as
      | { code?: string; message?: string; details?: unknown }
      | undefined;
    if (error.response && body?.code) {
      return new ApiError(
        error.response.status,
        body.code,
        body.message ?? "Request failed",
        body.details,
      );
    }
    if (!error.response) {
      return new ApiError(
        0,
        "NETWORK_ERROR",
        "Can't reach the server. Check your connection and try again.",
      );
    }
  }
  return new ApiError(
    500,
    "UNKNOWN_ERROR",
    "Something went wrong. Please try again.",
  );
}

/**
 * For catch blocks: an ApiError as is; anything else (a bug in our code, say)
 * is logged for developers and becomes a generic UNKNOWN_ERROR, so its
 * technical message never reaches the screen.
 */
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  console.error(error);
  return toApiError(error);
}

/**
 * One API call: resolves with the response body, rejects with an ApiError.
 * The query and mutation hooks are built on this; use it directly only
 * outside React.
 */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const { data } = await api.request<T>(config);
    return data;
  } catch (error) {
    throw toApiError(error);
  }
}
