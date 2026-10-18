"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { asApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useConfirmPlace } from "../services/public.service";

const MESSAGES: Record<string, { title: string; body: string }> = {
  INVALID_TOKEN: {
    title: "This link doesn't work",
    body: "It may be more than a day old, or cut short. Ask for your place again from the event's page.",
  },
  EVENT_FULL: { title: "The event filled up", body: "Every place went before you confirmed." },
  REGISTRATION_CLOSED: { title: "Registration closed", body: "The organisers stopped taking registrations before you confirmed." },
  EVENT_ENDED: { title: "This event is over", body: "It finished before you confirmed." },
  EVENT_NOT_OPEN: { title: "This event was called off", body: "It isn't taking registrations any more." },
  EVENT_NOT_FOUND: { title: "No event here", body: "The event may have been removed." },
};

/**
 * /e/[eventId]/confirm?token=…: the link from the "confirm your place" email.
 * Takes the place, then shows the ticket. Clicking the link twice is fine.
 */
export default function ConfirmPlaceContainer() {
  const { eventId } = useParams<{ eventId: string }>();
  const token = useSearchParams().get("token");
  const router = useRouter();
  const confirm = useConfirmPlace(eventId);
  const [failure, setFailure] = useState<string | null>(token ? null : "INVALID_TOKEN");
  // confirm once per page load, even if React runs the effect twice
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    confirm.mutateAsync({ token }).then(
      ({ ticketToken }) => router.replace(`/t/${ticketToken}`),
      (error: unknown) => setFailure(asApiError(error).code),
    );
  }, [token, confirm, router]);

  if (!failure) {
    return (
      <div className="grid min-h-[60svh] place-items-center px-5" role="status">
        <div className="flex flex-col items-center gap-3 text-center">
          <LoaderCircle className="size-7 animate-spin text-cobalt motion-reduce:animate-none" aria-hidden />
          <p className="text-2xl font-extrabold font-stretch-70%">Confirming your place</p>
        </div>
      </div>
    );
  }

  const message = MESSAGES[failure] ?? {
    title: "Couldn't confirm your place",
    body: failure === "NETWORK_ERROR" ? "Can't reach Muster. Check your connection, then reload." : "Try the link again in a moment.",
  };
  return (
    <div className="mx-auto max-w-md px-5 py-16" role="alert">
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-5xl leading-none font-extrabold font-stretch-70%">{message.title}</h1>
      <p className="mt-3 text-muted-foreground">{message.body}</p>
      <Link href={`/e/${eventId}`} className={cn(buttonVariants({ size: "lg" }), "mt-6 h-11 font-semibold")}>
        Back to the event
      </Link>
    </div>
  );
}
