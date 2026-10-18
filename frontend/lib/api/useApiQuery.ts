import { type QueryKey, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { type ApiError, request } from "./client";

type ApiQueryOptions<TData, TSelected> = Omit<
  UseQueryOptions<TData, ApiError, TSelected>,
  "queryKey" | "queryFn"
>;

/**
 * A GET (or any read) as a TanStack query. Services wrap it in their own
 * hooks so screens never see URLs or keys:
 *
 *   export const useClub = (clubId: string) =>
 *     useApiQuery<Club>(["clubs", clubId], { url: `/clubs/${clubId}` });
 *
 * The request is cancelled if the component unmounts or the key changes.
 * `options` takes anything useQuery does (enabled, select, staleTime, ...).
 */
export function useApiQuery<TData, TSelected = TData>(
  queryKey: QueryKey,
  config: AxiosRequestConfig,
  options?: ApiQueryOptions<TData, TSelected>,
) {
  return useQuery<TData, ApiError, TSelected>({
    queryKey,
    queryFn: ({ signal }) => request<TData>({ method: "get", ...config, signal }),
    ...options,
  });
}
