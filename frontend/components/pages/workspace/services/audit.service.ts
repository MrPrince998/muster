import { useInfiniteQuery } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import type { AuditPage } from "@/types/audit.interface";

/** The workspace's audit log, newest first, a page at a time (owner and admins). */
export const useAuditLog = (orgId: string, clubId: string | null) =>
  useInfiniteQuery({
    queryKey: ["orgs", orgId, "audit", clubId],
    queryFn: ({ pageParam }) =>
      request<AuditPage>({
        url: `/orgs/${orgId}/audit`,
        params: { ...(clubId && { clubId }), ...(pageParam && { before: pageParam }), limit: 50 },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });
