"use client";

import { CircleCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { asApiError } from "@/lib/api/client";
import { paymentsRedirect, usePaymentStatus, useRefreshPayments } from "../../services/payment.service";

/**
 * Selling tickets: the workspace connects its own Stripe account, and ticket
 * money goes there (Muster never holds it). Stripe's sign-up comes back here
 * with ?stripe=return, and the page asks Stripe how it went.
 */
export function PaymentsSection({ orgId }: { orgId: string }) {
  const status = usePaymentStatus(orgId);
  const refresh = useRefreshPayments(orgId);
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
          ? "Payments aren't switched on for this Muster yet."
          : "Couldn't reach Stripe. Try again in a moment.",
      );
    }
  };

  const data = status.data;
  // this Muster has no Stripe keys: nothing to set up, so say nothing
  if (!data?.available) return null;

  return (
    <section aria-labelledby="payments-heading" className="space-y-4 border-b py-10">
      <div>
        <h2 id="payments-heading" className="text-xl font-bold font-stretch-80%">
          Paid tickets
        </h2>
        <p className="mt-1 max-w-prose text-muted-foreground">
          Sell tickets through your own Stripe account: the money goes straight to it, and Stripe pays it out to your
          bank. Refunds come back out of it too.
        </p>
      </div>

      {data.ready ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck className="size-5 text-emerald-600" aria-hidden />
            Ready to sell tickets{data.currency ? ` in ${data.currency.toUpperCase()}` : ""}
          </p>
          <Button variant="outline" onClick={() => go("dashboard")} disabled={leaving !== null}>
            {leaving === "dashboard" ? <LoaderCircle className="animate-spin" aria-hidden /> : <ExternalLink aria-hidden />}
            Open Stripe dashboard
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {data.connected && (
            <p className="max-w-prose text-sm">
              Stripe still needs a few details before you can take payments.{" "}
              {refresh.isPending ? "Checking with Stripe…" : "Pick up where you left off."}
            </p>
          )}
          <Button onClick={() => go("connect")} disabled={leaving !== null}>
            {leaving === "connect" && <LoaderCircle className="animate-spin" aria-hidden />}
            {data.connected ? "Finish setting up Stripe" : "Connect Stripe"}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
