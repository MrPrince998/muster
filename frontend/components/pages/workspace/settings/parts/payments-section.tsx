"use client";

import { Check, CircleCheck, ExternalLink, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { asApiError } from "@/lib/api/client";
import { apiUrl, resizeImage } from "@/lib/image";
import { cn } from "@/lib/utils";
import {
  DIRECT_CURRENCIES,
  type PaymentMethod,
  type PaymentStatus,
  paymentsRedirect,
  setPaymentQr,
  usePaymentStatus,
  useRefreshPayments,
  useUpdatePaymentSettings,
} from "../../services/payment.service";

const currencyName = (code: string) => {
  try {
    return new Intl.DisplayNames(["en-GB"], { type: "currency" }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
};

/**
 * Selling tickets, one of two ways, and either way the money goes straight
 * to the workspace (Muster never holds it): its own Stripe account, or paid
 * to the organisers directly (eSewa, Khalti, a bank, cash), for places
 * Stripe doesn't serve. Stripe's sign-up comes back here with
 * ?stripe=return, and the page asks Stripe how it went.
 */
export function PaymentsSection({ orgId }: { orgId: string }) {
  const status = usePaymentStatus(orgId);
  const data = status.data;
  // the way being looked at; saved only when they say so
  const [choice, setChoice] = useState<PaymentMethod | null>(null);
  const shown = choice ?? data?.method ?? null;

  return (
    <section aria-labelledby="payments-heading" className="space-y-4 border-b py-10">
      <div>
        <h2 id="payments-heading" className="text-xl font-bold font-stretch-80%">
          Paid tickets
        </h2>
        <p className="mt-1 max-w-prose text-muted-foreground">
          Choose how people pay for tickets. Either way the money goes straight to you: Muster never holds it.
        </p>
      </div>

      {!data ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-hidden />
      ) : (
        <>
          <fieldset className="grid gap-2">
            <legend className="sr-only">How people pay</legend>
            <MethodOption
              value="stripe"
              checked={shown === "stripe"}
              current={data.method === "stripe"}
              disabled={!data.available}
              onChange={setChoice}
              label="Through Stripe"
              hint={
                data.available
                  ? "Cards, paid into your own Stripe account. Tickets go out and refunds come back automatically."
                  : "Not available here yet."
              }
            />
            <MethodOption
              value="direct"
              checked={shown === "direct"}
              current={data.method === "direct"}
              onChange={setChoice}
              label="Directly to you"
              hint="eSewa, Khalti, a bank transfer or cash: you say how. Places are held while people pay, and you confirm each payment."
            />
          </fieldset>

          {shown === "direct" ? (
            <DirectSettings orgId={orgId} status={data} onSaved={() => setChoice(null)} />
          ) : (
            <StripeSettings orgId={orgId} status={data} onSwitched={() => setChoice(null)} />
          )}
        </>
      )}
    </section>
  );
}

function MethodOption({
  value,
  checked,
  current,
  disabled = false,
  onChange,
  label,
  hint,
}: {
  value: PaymentMethod;
  checked: boolean;
  current: boolean;
  disabled?: boolean;
  onChange: (value: PaymentMethod) => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors has-checked:border-cobalt has-checked:bg-cobalt-50",
        "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name="payment-method"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-1 accent-cobalt"
      />
      <span>
        <span className="block font-medium">
          {label}
          {current && <span className="font-normal text-muted-foreground"> (current)</span>}
        </span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/** Stripe: switch to it, connect the account (or finish connecting), and its dashboard. */
function StripeSettings({ orgId, status, onSwitched }: { orgId: string; status: PaymentStatus; onSwitched: () => void }) {
  const refresh = useRefreshPayments(orgId);
  const update = useUpdatePaymentSettings(orgId);
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState<"connect" | "dashboard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = useSearchParams().get("stripe");
  const asked = useRef(false);

  // back from Stripe's sign-up: has it finished?
  useEffect(() => {
    if (!back || asked.current) return;
    asked.current = true;
    refresh.mutate();
  }, [back, refresh]);

  const go = async (to: "connect" | "dashboard") => {
    setLeaving(to);
    setError(null);
    try {
      window.location.assign((await paymentsRedirect(orgId, to)).url);
    } catch (failure) {
      setLeaving(null);
      setError(
        asApiError(failure).code === "PAYMENTS_UNAVAILABLE"
          ? "Stripe isn't switched on for this Muster yet."
          : "Couldn't reach Stripe. Try again in a moment.",
      );
    }
  };

  if (!status.available) return null;

  // paid directly now: one click back to Stripe, which keeps its account
  if (status.method !== "stripe") {
    return (
      <div className="space-y-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          New paid events will be priced in your Stripe account&rsquo;s currency. Places already held for direct
          payments stay held, and you can still confirm them.
        </p>
        <Button
          onClick={async () => {
            setError(null);
            try {
              queryClient.setQueryData(["orgs", orgId, "payments"], await update.mutateAsync({ method: "stripe" }));
              onSwitched();
            } catch {
              setError("Couldn't switch to Stripe. Try again.");
            }
          }}
          disabled={update.isPending}
        >
          {update.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
          Use Stripe
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {status.ready ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck className="size-5 text-emerald-600" aria-hidden />
            Ready to sell tickets{status.currency ? ` in ${status.currency.toUpperCase()}` : ""}
          </p>
          <Button variant="outline" onClick={() => go("dashboard")} disabled={leaving !== null}>
            {leaving === "dashboard" ? <LoaderCircle className="animate-spin" aria-hidden /> : <ExternalLink aria-hidden />}
            Open Stripe dashboard
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {status.connected && (
            <p className="max-w-prose text-sm">
              Stripe still needs a few details before you can take payments.{" "}
              {refresh.isPending ? "Checking with Stripe…" : "Pick up where you left off."}
            </p>
          )}
          <Button onClick={() => go("connect")} disabled={leaving !== null}>
            {leaving === "connect" && <LoaderCircle className="animate-spin" aria-hidden />}
            {status.connected ? "Finish setting up Stripe" : "Connect Stripe"}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Paid directly: how to pay you, in what currency, your QR code, and how long a place waits. */
function DirectSettings({ orgId, status, onSaved }: { orgId: string; status: PaymentStatus; onSaved: () => void }) {
  const update = useUpdatePaymentSettings(orgId);
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState(status.direct.currency ?? "npr");
  const [instructions, setInstructions] = useState(status.direct.instructions ?? "");
  const [holdHours, setHoldHours] = useState(String(status.direct.holdHours));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const qrInput = useRef<HTMLInputElement>(null);

  const hours = Number(holdHours);
  const hoursOk = Number.isInteger(hours) && hours >= 1 && hours <= 168;
  const ready = status.method === "direct" && status.ready;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    if (!instructions.trim()) return setError("Say how people should pay you.");
    if (!hoursOk) return setError("Hold places for 1 to 168 hours.");
    setError(null);
    try {
      // the new status straight away, so the choice doesn't flicker back while it refetches
      queryClient.setQueryData(
        ["orgs", orgId, "payments"],
        await update.mutateAsync({ method: "direct", currency, instructions: instructions.trim(), holdHours: hours }),
      );
      setSaved(true);
      onSaved();
    } catch (failure) {
      setError(
        asApiError(failure).code === "DIRECT_DETAILS_REQUIRED"
          ? "Say how people should pay you, and in what currency."
          : "Couldn't save. Try again.",
      );
    }
  };

  const changeQr = async (file: File | null) => {
    setQrError(null);
    setQrBusy(true);
    try {
      // a QR code must stay sharp: sent as it is unless it's too big
      const image = !file
        ? null
        : file.size <= 2 * 1024 * 1024 && ["image/png", "image/jpeg", "image/webp"].includes(file.type)
          ? file
          : await resizeImage(file, 1200);
      const next = await setPaymentQr(orgId, image);
      queryClient.setQueryData(["orgs", orgId, "payments"], next);
    } catch {
      setQrError("That image couldn't be used. Try a PNG or JPEG of your QR code.");
    } finally {
      setQrBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      {ready && (
        <p className="flex items-center gap-2 font-medium">
          <CircleCheck className="size-5 text-emerald-600" aria-hidden />
          Ready to sell tickets in {status.currency?.toUpperCase()}, paid to you directly
        </p>
      )}

      <Field>
        <FieldLabel htmlFor="direct-instructions">How to pay you</FieldLabel>
        <Textarea
          id="direct-instructions"
          rows={4}
          maxLength={1000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={"eSewa or Khalti: 98XXXXXXXX (Hiking Club)\nOr pay cash at our Tuesday meet"}
        />
        <FieldDescription>
          Shown to everyone buying a ticket, and emailed to them, with a reference to put on the payment.
        </FieldDescription>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="direct-currency">Currency</FieldLabel>
          <select
            id="direct-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-11 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {DIRECT_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}, {currencyName(code)}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="direct-hold">Hold a place for</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="direct-hold"
              inputMode="numeric"
              value={holdHours}
              aria-invalid={!hoursOk}
              onChange={(e) => setHoldHours(e.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>hours</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>Then it goes back on offer, unless you&rsquo;ve confirmed the payment.</FieldDescription>
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Payment QR code (optional)</p>
        <div className="flex flex-wrap items-end gap-3">
          {status.direct.qrUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- the API's file: nothing for next/image to optimise
            <img
              src={apiUrl(status.direct.qrUrl)}
              alt="Your payment QR code"
              className="size-32 rounded-lg border bg-white object-contain p-1.5"
            />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => qrInput.current?.click()} disabled={qrBusy}>
              {qrBusy ? <LoaderCircle className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
              {status.direct.qrUrl ? "Change" : "Add your QR code"}
            </Button>
            {status.direct.qrUrl && (
              <Button type="button" variant="ghost" onClick={() => changeQr(null)} disabled={qrBusy}>
                <Trash2 aria-hidden />
                Remove
              </Button>
            )}
          </div>
        </div>
        <input
          ref={qrInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Payment QR code file"
          onChange={(e) => {
            void changeQr(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        {qrError && <p className="text-sm text-destructive">{qrError}</p>}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
          {status.method === "direct" ? "Save" : "Use direct payments"}
        </Button>
        {saved && (
          <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="size-4 text-cobalt" aria-hidden />
            Saved
          </p>
        )}
      </div>
    </form>
  );
}
