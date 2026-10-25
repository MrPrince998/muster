"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { apiUrl } from "@/lib/image";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DirectPayment } from "@/types/event.interface";

// "Wednesday 28 October, 18:30": when the hold runs out, on the event's clock
const heldUntil = (at: string, timeZone?: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));

/**
 * A place held while someone pays the organisers directly: how much, how
 * (their words, and their QR code), the reference to put on the payment, and
 * how long the place waits. The ticket follows once an organiser confirms it.
 */
export function PayDirectly({
  payment,
  timeZone,
  className,
  children,
}: {
  payment: DirectPayment;
  timeZone?: string;
  className?: string;
  // what they can do next: give the place up, go back to the event
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="pay-directly-heading" className={cn("rounded-xl border bg-card p-4", className)}>
      <h3 id="pay-directly-heading" className="text-sm font-semibold">
        Your place is held. Pay the organisers to get your ticket.
      </h3>
      <p className="mt-3 text-3xl leading-none font-extrabold font-stretch-70% tabular-nums">
        {formatMoney(payment.amountCents, payment.currency)}
      </p>
      {payment.ticketType && <p className="mt-1 text-sm text-muted-foreground">{payment.ticketType}</p>}

      <p className="mt-4 text-sm whitespace-pre-line">{payment.instructions}</p>
      {payment.qrUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- the API's file: nothing for next/image to optimise
        <img
          src={apiUrl(payment.qrUrl)}
          alt="The organisers' payment QR code"
          className="mt-3 aspect-square w-full max-w-56 rounded-lg border bg-white object-contain p-2"
        />
      )}

      <div className="mt-4">
        <p className="text-sm">Put this reference on the payment</p>
        <Reference value={payment.reference} />
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        Held until {heldUntil(payment.expiresAt, timeZone)}. Once the organisers see your payment, your ticket arrives by
        email. Muster doesn&rsquo;t take this payment, so any refund is between you and them.
      </p>
      {children && <div className="mt-4 flex flex-col gap-2">{children}</div>}
    </section>
  );
}

function Reference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard: it's six characters, typed easily enough
    }
  };
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="text-2xl font-bold tracking-[0.2em] tabular-nums" data-testid="payment-reference">
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-cobalt hover:bg-cobalt-50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
