"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { asApiError } from "@/lib/api/client";
import type { Answers } from "@/types/event.interface";
import { answerProblems } from "../../workspace/shared/question-fields";
import { usePublicEvent, useRequestPlace } from "../services/public.service";
import { guestPlaceSchema, type GuestPlaceValues } from "../validation/guest-place.schema";
import PublicEventView from "./public-event.view";

/** Why asking for a place failed, in the card. */
function placeMessage(code: string): string {
  switch (code) {
    case "EVENT_FULL":
      return "The last place has just gone.";
    case "CODE_NOT_VALID":
      return "That discount code doesn't work for this event.";
    case "TICKET_TYPE_SOLD_OUT":
      return "That ticket has just sold out. Choose another.";
    case "TICKET_SALES_ENDED":
      return "That ticket is no longer on sale.";
    case "INVALID_ANSWERS":
      return "Some answers need another look.";
    case "SOLD_OUT":
      return "Sold out: the last ticket has just gone.";
    case "REGISTRATION_CLOSED":
      return "Registration has just closed.";
    case "EVENT_ENDED":
      return "This event is over.";
    case "EVENT_NOT_OPEN":
      return "This event isn't taking registrations.";
    case "TOO_MANY_REQUESTS":
      return "Too many tries. Wait a minute, then try again.";
    case "NETWORK_ERROR":
      return "Can't reach Muster. Check your connection, then try again.";
    default:
      return "Couldn't send the link. Try again in a moment.";
  }
}

/** /e/[eventId]: a public event anyone with the link can see and get a ticket for. */
export default function PublicEventContainer() {
  const { eventId } = useParams<{ eventId: string }>();
  const event = usePublicEvent(eventId);
  const request = useRequestPlace(eventId);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // back from Stripe's checkout: ?paid=1 or ?paid=0
  const paid = useSearchParams().get("paid");
  const form = useForm<GuestPlaceValues>({
    resolver: zodResolver(guestPlaceSchema),
    defaultValues: { name: "", email: "" },
    mode: "onTouched",
  });

  // answers to the event's questions, checked with the rest before the link is sent
  const [answers, setAnswers] = useState<Answers>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  // which ticket (the first on sale, until they choose), and any code
  const [ticketChoice, setTicketChoice] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const ticketTypeId = ticketChoice ?? event.data?.ticketTypes.find((t) => t.onSale)?.id;

  const onSubmit = form.handleSubmit(async ({ name, email }) => {
    const problems = answerProblems(event.data?.questions ?? [], answers);
    setAnswerErrors(problems);
    if (Object.keys(problems).length > 0) return;
    try {
      const given = Object.fromEntries(
        Object.entries(answers)
          .map(([id, value]) => [id, value.trim()])
          .filter(([, value]) => value),
      );
      const chosen = event.data?.ticketTypes.find((t) => t.id === ticketTypeId);
      await request.mutateAsync({
        name,
        email,
        answers: given,
        ...(chosen && { ticketTypeId: chosen.id }),
        ...(chosen && chosen.priceCents > 0 && code.trim() && { code: code.trim() }),
      });
      setSentTo(email);
    } catch (error) {
      form.setError("root", { message: placeMessage(asApiError(error).code) });
      // the card shows the latest: full, closed, over
      void event.refetch();
    }
  });

  if (event.isPending) {
    return (
      <div className="grid min-h-[60svh] place-items-center" role="status">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Loading the event</span>
      </div>
    );
  }
  if (event.isError || !event.data) {
    const missing = event.error?.code === "EVENT_NOT_FOUND" || event.error?.status === 404 || event.error?.status === 400;
    return (
      <div className="mx-auto max-w-xl px-5 py-16 sm:px-8">
        <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">
          {missing ? "No event here" : "Couldn't load the event"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {missing
            ? "The link may be wrong, or the event isn't open to the public. Ask whoever shared it."
            : "Check your connection, then reload the page."}
        </p>
        <Link href="/login" className="mt-6 inline-block font-medium text-cobalt underline-offset-4 hover:underline">
          Sign in to Muster
        </Link>
      </div>
    );
  }

  return (
    <PublicEventView
      event={event.data}
      form={form}
      onSubmit={onSubmit}
      sentTo={sentTo}
      questions={{ answers, onChange: setAnswers, problems: answerErrors }}
      tickets={{ chosen: ticketTypeId, onChoose: setTicketChoice, code, onCode: setCode }}
      paymentReturn={paid === "1" ? "paid" : paid === "0" ? "cancelled" : null}
      onAskAgain={() => {
        setSentTo(null);
        form.reset({ name: form.getValues("name"), email: "" });
      }}
    />
  );
}
