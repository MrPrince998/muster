"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Star } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { asApiError, request } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface FeedbackForm {
  eventTitle: string;
  clubName: string;
  endedAt: string;
  rating: number | null;
  comment: string | null;
}

const WORDS = ["", "Poor", "Not great", "OK", "Good", "Great"];

/**
 * /feedback?token=...: "How was it?" from the link emailed after an event.
 * No sign-in: the link is the person's own. A rating out of five and a
 * comment if they like; they can come back and change it.
 */
export default function FeedbackContainer() {
  const token = useSearchParams().get("token") ?? "";
  const form = useQuery({
    queryKey: ["feedback", token],
    queryFn: () => request<FeedbackForm>({ url: `/public/feedback/${encodeURIComponent(token)}` }),
    enabled: !!token,
    retry: false,
  });
  // the answer being made; starts from what they said before, if anything
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token || form.isError) {
    const closed = form.error && asApiError(form.error).code === "FEEDBACK_CLOSED";
    return (
      <Message
        title="This link doesn't work"
        body={closed ? "Feedback for this event has closed." : "It may be incomplete. Use the link in the email again."}
      />
    );
  }
  if (form.isPending) {
    return (
      <div className="grid min-h-[50svh] place-items-center" role="status">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  const data = form.data;
  const chosen = rating ?? data.rating;
  const text = comment ?? data.comment ?? "";

  if (saved) {
    return (
      <Message
        title="Thank you"
        body={`${data.clubName} will see your answer, but not your name. You can change it from the same link for a month.`}
      />
    );
  }

  const submit = async () => {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    try {
      await request({
        method: "put",
        url: `/public/feedback/${encodeURIComponent(token)}`,
        data: { rating: chosen, ...(text.trim() && { comment: text.trim() }) },
      });
      setSaved(true);
    } catch (failure) {
      setError(
        asApiError(failure).code === "FEEDBACK_CLOSED"
          ? "Feedback for this event has closed."
          : "Couldn't send it. Check your connection, then try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-5 py-14">
      <p className="font-semibold text-cobalt">{data.clubName}</p>
      <h1 className="mt-1 text-5xl leading-none font-extrabold break-words font-stretch-70%">How was {data.eventTitle}?</h1>

      <fieldset className="mt-8">
        <legend className="text-sm font-medium">Your rating</legend>
        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer rounded-lg p-1 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
              <input
                type="radio"
                name="rating"
                value={n}
                checked={chosen === n}
                onChange={() => setRating(n)}
                className="sr-only"
              />
              <Star
                className={cn("size-10 transition-colors", chosen && n <= chosen ? "fill-cobalt text-cobalt" : "text-zinc-300")}
                aria-hidden
              />
              <span className="sr-only">
                {n} out of 5, {WORDS[n]}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 h-5 text-sm text-muted-foreground" aria-live="polite">
          {chosen ? WORDS[chosen] : ""}
        </p>
      </fieldset>

      <div className="mt-6 space-y-1.5">
        <label htmlFor="feedback-comment" className="text-sm font-medium">
          Anything to add? <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="feedback-comment"
          rows={4}
          maxLength={1000}
          value={text}
          placeholder="What worked, what to change next time"
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button size="lg" className="mt-6 h-11 w-full font-semibold" onClick={submit} disabled={!chosen || saving}>
        {saving && <LoaderCircle className="animate-spin" aria-hidden />}
        {data.rating ? "Update my answer" : "Send"}
      </Button>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        {data.clubName} sees your rating and comment, not your name.
      </p>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">{title}</h1>
      <p className="mt-3 text-muted-foreground">{body}</p>
    </div>
  );
}
