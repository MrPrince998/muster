import { useApiQuery } from "@/lib/api/useApiQuery";

/** GET .../feedback: what people who came thought, without names. */
export interface FeedbackSummary {
  count: number;
  average: number | null;
  // how many gave 1, 2, 3, 4 and 5
  ratings: number[];
  // how many were asked (everyone who came)
  asked: number;
  comments: { rating: number; comment: string; at: string }[];
}

/** An ended event's feedback; needs analytics.view. */
export const useEventFeedback = (clubId: string, eventId: string, enabled: boolean) =>
  useApiQuery<FeedbackSummary>(
    ["clubs", clubId, "events", eventId, "feedback"],
    { url: `/clubs/${clubId}/events/${eventId}/feedback` },
    { enabled },
  );
