import { keepPreviousData } from "@tanstack/react-query";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { SearchResult } from "@/types";

export const SEARCH_MIN_LENGTH = 2;

/**
 * Searches your workspaces. Pass the debounced text: nothing is sent under
 * two characters, and the last results stay on screen while the next load.
 */
export const useSearch = (query: string) => {
  const q = query.trim();
  return useApiQuery<SearchResult>(
    ["search", q],
    { url: "/search", params: { q } },
    { enabled: q.length >= SEARCH_MIN_LENGTH, placeholderData: keepPreviousData, staleTime: 30_000 },
  );
};
