import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";

// none, one email as each event is published, or Monday's digest
export type EventEmails = "off" | "instant" | "weekly";

const key = (clubId: string) => ["clubs", clubId, "event-emails"];

/** Which new-event emails you get from this club. */
export const useEventEmails = (clubId: string) =>
  useApiQuery<{ eventEmails: EventEmails }>(key(clubId), { url: `/clubs/${clubId}/event-emails` });

export const useSetEventEmails = (clubId: string) =>
  useApiMutation<{ eventEmails: EventEmails }, { eventEmails: EventEmails }>(
    { method: "put", url: `/clubs/${clubId}/event-emails` },
    { invalidates: [key(clubId)] },
  );
