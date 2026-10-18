import {
  type QueryKey,
  type UseMutationOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { type ApiError, request } from "./client";

type ApiMutationOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, ApiError, TVariables>,
  "mutationFn"
> & {
  /** Queries to refetch after success, e.g. [["clubs"]] after creating a club. */
  invalidates?: QueryKey[];
};

/**
 * A write (POST, PATCH, DELETE) as a TanStack mutation. Two forms:
 *
 *   // fixed URL: the variables are sent as the JSON body
 *   useApiMutation<AuthTokens, SignInInput>({ method: "post", url: "/auth/signin" });
 *
 *   // URL or body built from the variables
 *   useApiMutation<void, { clubId: string }>(
 *     ({ clubId }) => ({ method: "delete", url: `/clubs/${clubId}` }),
 *     { invalidates: [["clubs"]] },
 *   );
 *
 * In a form, call `mutateAsync` inside handleSubmit so react-hook-form's
 * isSubmitting stays true until the request settles.
 */
export function useApiMutation<TData, TVariables = void>(
  config: AxiosRequestConfig | ((variables: TVariables) => AxiosRequestConfig),
  { invalidates, onSuccess, ...options }: ApiMutationOptions<TData, TVariables> = {},
) {
  const queryClient = useQueryClient();

  return useMutation<TData, ApiError, TVariables>({
    mutationFn: (variables) =>
      request<TData>(
        typeof config === "function" ? config(variables) : { ...config, data: variables },
      ),
    ...options,
    onSuccess: async (...args) => {
      if (invalidates?.length) {
        await Promise.all(invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      }
      return onSuccess?.(...args);
    },
  });
}
