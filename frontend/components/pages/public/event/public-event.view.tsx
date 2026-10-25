"use client";

import { CalendarDays, Clock, LoaderCircle, MailCheck, MapPin } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { apiUrl } from "@/lib/image";
import { formatMoney } from "@/lib/money";
import type { Answers } from "@/types/event.interface";
import { QuestionFields } from "../../workspace/shared/question-fields";
import { ticketNote, ticketPrice } from "../../workspace/dialogs/get-ticket-dialog";
import { cn } from "@/lib/utils";
import type { PublicEvent } from "@/types";
import { differsFromDevice, zoneCity, zoneName } from "@/lib/time-zone";
import { formatFullDate, formatTimeRange } from "../../workspace/org-home/parts/format";
import { AddToCalendar } from "../../workspace/shared/add-to-calendar";
import { publicCalendarUrl, publicEventUrl } from "../services/public.service";
import type { GuestPlaceValues } from "../validation/guest-place.schema";
import { TestCardNote } from "@/components/common/test-card-note";

// the stub's notches, where the form meets the band (the same ticket as everywhere else)
const notches = [
  "radial-gradient(circle 0.75rem at 0 var(--tear), transparent 98%, #000) left / 51% 100% no-repeat",
  "radial-gradient(circle 0.75rem at 100% var(--tear), transparent 98%, #000) right / 51% 100% no-repeat",
].join(", ");

export interface PublicEventViewProps {
  event: PublicEvent;
  form: UseFormReturn<GuestPlaceValues>;
  onSubmit: (event: React.FormEvent) => void;
  // where the confirmation link went, once asked
  sentTo: string | null;
  onAskAgain: () => void;
  // back from Stripe: paid (the ticket is on its way by email) or not
  paymentReturn: "paid" | "cancelled" | null;
  // answers to the event's questions, kept by the container
  questions: { answers: Answers; onChange: (answers: Answers) => void; problems: Record<string, string> };
  // the ticket chosen (events with ticket types), and any discount code
  tickets: { chosen: string | undefined; onChoose: (id: string) => void; code: string; onCode: (code: string) => void };
}

/** A public event: what, when and where, and a ticket-shaped card to get a place. Presentational. */
export default function PublicEventView({ event, form, onSubmit, sentTo, onAskAgain, paymentReturn, questions, tickets }: PublicEventViewProps) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16 lg:py-16">
      <article className="min-w-0">
        {event.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- the API's file: nothing for next/image to optimise
          <img
            src={apiUrl(event.coverUrl)}
            alt=""
            className="mb-8 aspect-[16/9] w-full rounded-2xl object-cover"
          />
        )}
        <p className="font-semibold text-cobalt">
          {event.clubName}, {event.workspaceName}
        </p>
        <h1
          className={cn(
            "mt-2 text-5xl leading-[0.95] font-extrabold break-words font-stretch-70% sm:text-7xl",
            event.status === "cancelled" && "text-muted-foreground line-through decoration-stamp/60",
          )}
        >
          {event.title}
        </h1>
        <dl className="mt-8 space-y-3 text-lg">
          <Detail icon={CalendarDays} label="Date">
            {formatFullDate(event.startsAt, event.timeZone)}
          </Detail>
          <Detail icon={Clock} label="Time">
            {formatTimeRange(event.startsAt, event.endsAt, event.timeZone)}
            {differsFromDevice(event.timeZone) && (
              <span className="ml-2 text-base text-muted-foreground">
                {zoneCity(event.timeZone)} time ({zoneName(event.startsAt, event.timeZone)})
              </span>
            )}
          </Detail>
          {event.location && (
            <Detail icon={MapPin} label="Place">
              {event.location}
            </Detail>
          )}
        </dl>
        {event.status !== "cancelled" && !event.ended && (
          <AddToCalendar
            className="mt-6 items-start"
            icsHref={publicCalendarUrl(event.id)}
            event={{
              title: event.title,
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              location: event.location,
              details: `${event.clubName}, ${event.workspaceName}. ${publicEventUrl(event.id)}`,
            }}
          />
        )}
        {event.description && (
          <p className="mt-8 max-w-prose text-pretty whitespace-pre-line text-muted-foreground">{event.description}</p>
        )}
      </article>

      <aside aria-label="Get a ticket" className="lg:sticky lg:top-10 lg:self-start">
        <div className="[filter:drop-shadow(0_0_0.5px_rgb(26_31_54/0.3))_drop-shadow(0_14px_24px_rgb(47_69_216/0.16))]">
          <div
            style={{ mask: notches, WebkitMask: notches } as React.CSSProperties}
            className="overflow-hidden rounded-2xl bg-white [--tear:5.5rem]"
          >
            <div className="flex h-(--tear) flex-col justify-center bg-cobalt px-6 text-white">
              <Places event={event} />
            </div>
            <div className="mx-5 border-t-2 border-dashed border-zinc-200" />
            <div className="p-6">
              <Card event={event} form={form} onSubmit={onSubmit} sentTo={sentTo} onAskAgain={onAskAgain} paymentReturn={paymentReturn} questions={questions} tickets={tickets} />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Places({ event }: { event: PublicEvent }) {
  const closed = event.status === "cancelled" || event.ended || !event.registrationOpen;
  const headline =
    event.status === "cancelled"
      ? "Not happening"
      : event.ended
        ? "This event is over"
        : !event.registrationOpen
          ? "Registration closed"
          : event.placesLeft === null
            ? "Places open"
            : event.placesLeft === 0
              ? event.price
                ? "Sold out"
                : "Full"
              : `${event.placesLeft} ${event.placesLeft === 1 ? "place" : "places"} left`;
  return (
    <>
      <p className="text-3xl leading-none font-extrabold font-stretch-70%">{headline}</p>
      <p className="mt-1 text-sm text-cobalt-100">
        {closed
          ? "No new tickets"
          : event.placesLeft === 0
            ? event.price
              ? "Every ticket has gone"
              : event.waitlistCount > 0
                ? `${event.waitlistCount} waiting. Places go in order.`
                : "Join the waitlist for the next place"
            : event.price
              ? `${event.ticketTypes.filter((t) => t.priceCents > 0).length > 1 || event.ticketTypes.some((t) => t.priceCents === 0) ? "From " : ""}${formatMoney(event.price.amountCents, event.price.currency)}, with a QR ticket for the door`
              : "Free, with a QR ticket for the door"}
      </p>
    </>
  );
}

function Card({ event, form, onSubmit, sentTo, onAskAgain, paymentReturn, questions, tickets }: PublicEventViewProps) {
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  if (event.status === "cancelled") {
    return (
      <div>
        <p className="inline-block -rotate-3 rounded-lg border-[3px] border-stamp px-3 py-1 text-2xl leading-none font-extrabold text-stamp font-stretch-70%">
          Cancelled
        </p>
        {event.cancelReason && <p className="mt-4 text-sm">&ldquo;{event.cancelReason}&rdquo;</p>}
        <p className="mt-3 text-sm text-muted-foreground">Everyone with a ticket has been emailed.</p>
      </div>
    );
  }
  if (event.ended || !event.registrationOpen) {
    return (
      <p className="text-sm text-muted-foreground">
        {event.ended ? "It's already happened. Keep an eye out for the next one." : "The organisers have stopped taking registrations."}
      </p>
    );
  }
  if (paymentReturn === "paid") {
    return (
      <div role="status">
        <span className="grid size-10 place-items-center rounded-full bg-cobalt-50 text-cobalt">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <p className="mt-3 text-xl leading-tight font-extrabold font-stretch-70%">Payment received</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your ticket is on its way by email, with a link to its own page. Keep either to get in.
        </p>
      </div>
    );
  }
  // a paid event that's full has no waitlist: a ticket given back goes on sale again
  if (event.price && event.placesLeft === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Every ticket has gone. If someone gives theirs back, it&rsquo;s on sale again here.
      </p>
    );
  }
  const waitlist = event.placesLeft === 0;
  const chosenType = event.ticketTypes.find((t) => t.id === tickets.chosen);
  if (sentTo) {
    return (
      <div role="status">
        <span className="grid size-10 place-items-center rounded-full bg-cobalt-50 text-cobalt">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <p className="mt-3 text-xl leading-tight font-extrabold font-stretch-70%">Check your inbox</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a link to <span className="font-medium break-all text-foreground">{sentTo}</span>.{" "}
          {waitlist
            ? "Open it to join the waitlist; if a place opens up, your ticket arrives by email."
            : event.price
              ? "Open it to pay; your place is held while you do, and your ticket arrives straight after."
              : "Your place is held once you open it, and your ticket arrives straight after."}{" "}
          It works for 24 hours.
        </p>
        <button
          type="button"
          onClick={onAskAgain}
          className="mt-3 text-sm font-semibold text-cobalt underline-offset-4 hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="space-y-4">
      {paymentReturn === "cancelled" && (
        <p role="status" className="text-sm text-muted-foreground">
          Payment cancelled: nothing was charged. Ask again whenever you&rsquo;re ready.
        </p>
      )}
      <Field data-invalid={!!errors.name}>
        <FieldLabel htmlFor="guest-name">Your name</FieldLabel>
        <InputGroup className="h-11">
          <InputGroupInput id="guest-name" autoComplete="name" aria-invalid={!!errors.name} {...register("name")} />
        </InputGroup>
        <FieldError errors={[errors.name]} />
      </Field>
      <Field data-invalid={!!errors.email}>
        <FieldLabel htmlFor="guest-email">Email</FieldLabel>
        <InputGroup className="h-11">
          <InputGroupInput
            id="guest-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!errors.email}
            {...register("email")}
          />
        </InputGroup>
        <FieldError errors={[errors.email]} />
      </Field>
      {event.ticketTypes.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Ticket</legend>
          {event.ticketTypes.map((t) => {
            const note = ticketNote(t, event.timeZone);
            return (
              <label
                key={t.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors has-checked:border-cobalt has-checked:bg-cobalt-50",
                  "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  !t.onSale && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="guest-ticket"
                  value={t.id}
                  disabled={!t.onSale}
                  checked={tickets.chosen === t.id}
                  onChange={() => tickets.onChoose(t.id)}
                  className="mt-0.5 accent-cobalt"
                />
                <span className="flex-1">
                  <span className="block font-medium">{t.name}</span>
                  {note && <span className="text-muted-foreground">{note}</span>}
                </span>
                <span className="font-semibold tabular-nums">{ticketPrice(t)}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      {event.hasCodes && (chosenType?.priceCents ?? 0) > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="guest-code" className="text-sm font-medium">
            Discount code <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <InputGroup className="h-11">
            <InputGroupInput
              id="guest-code"
              value={tickets.code}
              maxLength={30}
              autoCapitalize="characters"
              onChange={(e) => tickets.onCode(e.target.value)}
            />
          </InputGroup>
        </div>
      )}
      {event.questions.length > 0 && (
        <QuestionFields
          questions={event.questions}
          answers={questions.answers}
          onChange={questions.onChange}
          problems={questions.problems}
          idPrefix="guest-question"
        />
      )}
      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Button type="submit" size="lg" className="h-11 w-full text-[15px] font-semibold" disabled={isSubmitting}>
        {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
        {isSubmitting
          ? "Sending…"
          : waitlist
            ? "Join the waitlist"
            : chosenType && chosenType.priceCents > 0
              ? `Buy a ticket for ${ticketPrice(chosenType)}`
              : "Get a ticket"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {waitlist
          ? "It's full right now. If someone gives their place back, it goes to whoever has waited longest."
          : event.price
            ? "We'll email you a link to confirm, then you pay through Stripe. No account needed."
            : "We'll email you a link to confirm. No account needed."}
      </p>
      {!waitlist && chosenType && chosenType.priceCents > 0 && <TestCardNote />}
    </form>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-1 size-5 shrink-0 text-cobalt" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
