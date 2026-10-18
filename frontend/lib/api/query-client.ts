import { QueryClient } from "@tanstack/react-query";
import type { ApiError } from "./client";

// Every query and mutation fails with an ApiError (see request()), so make
// that the default error type: `error.code` is typed without casting.
declare module "@tanstack/react-query" {
  interface Register {
    defaultError: ApiError;
  }
}

// 4xx means the request itself is wrong (bad input, no access, not found):
// sending it again gives the same answer. Retry only network and server errors.
const isWorthRetrying = (error: ApiError) => error.status === 0 || error.status >= 500;

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // data is fresh for 30s: moving between screens doesn't refetch
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < 2 && isWorthRetrying(error),
      },
      mutations: {
        // a repeated POST could create twice or send two emails
        retry: false,
      },
    },
  });
}
