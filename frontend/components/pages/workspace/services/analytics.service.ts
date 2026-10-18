import { useApiQuery } from "@/lib/api/useApiQuery";
import type { ClubAttendance } from "@/types";

/** A club's attendance. Needs analytics.view; pass enabled=false to skip it. */
export const useClubAttendance = (clubId: string | undefined, enabled = true) =>
  useApiQuery<ClubAttendance>(
    ["clubs", clubId ?? "", "analytics"],
    { url: `/clubs/${clubId}/analytics` },
    { enabled: !!clubId && enabled },
  );
