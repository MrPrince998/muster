"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEventFeedback } from "../../services/feedback.service";

/** After an event: how the people who came rated it, and what they said. Names are never shown. */
export function FeedbackSection({ clubId, eventId }: { clubId: string; eventId: string }) {
  const feedback = useEventFeedback(clubId, eventId, true);
  const data = feedback.data;

  return (
    <section aria-label="Feedback" className="space-y-3">
      <h3 className="text-sm font-semibold">How it went</h3>
      {feedback.isPending ? (
        <div className="h-20 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-hidden />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Couldn&rsquo;t load the feedback.</p>
      ) : data.count === 0 ? (
        <p className="text-sm text-muted-foreground">
          {data.asked > 0
            ? `${data.asked} ${data.asked === 1 ? "person was" : "people were"} asked how it went. No answers yet.`
            : "Everyone who came is asked how it went a couple of hours after it ends."}
        </p>
      ) : (
        <>
          <div className="flex items-end gap-4 rounded-xl bg-muted/60 p-4">
            <div>
              <p className="flex items-center gap-1 text-3xl leading-none font-extrabold font-stretch-70%">
                {data.average!.toFixed(1)}
                <Star className="size-5 fill-cobalt text-cobalt" aria-hidden />
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                from {data.count} of {data.asked} asked
              </p>
            </div>
            {/* the spread, 5 at the top */}
            <dl className="ml-auto grid w-32 gap-0.5 text-xs" aria-label="Ratings">
              {[5, 4, 3, 2, 1].map((stars) => {
                const n = data.ratings[stars - 1];
                return (
                  <div key={stars} className="flex items-center gap-1.5">
                    <dt className="w-2 tabular-nums text-muted-foreground">{stars}</dt>
                    <dd className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
                      <div
                        className={cn("h-full rounded-full", stars >= 4 ? "bg-cobalt" : stars === 3 ? "bg-cobalt/60" : "bg-stamp/70")}
                        style={{ width: `${(n / data.count) * 100}%` }}
                      />
                      <span className="sr-only">
                        {n} gave {stars}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
          {data.comments.length > 0 && (
            <ul className="space-y-2">
              {data.comments.map((c, i) => (
                <li key={i} className="rounded-lg border p-3 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground">{c.rating} out of 5</p>
                  <p className="mt-1 whitespace-pre-line">{c.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
