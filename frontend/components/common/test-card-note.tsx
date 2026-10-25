"use client";

import { FlaskConical } from "lucide-react";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { cn } from "@/lib/utils";

/** GET /payments/mode: whether payments are on, and whether they're real. */
interface PaymentMode {
  enabled: boolean;
  // Stripe's test keys: no real money moves, and checkout takes test cards
  testMode: boolean;
}

// it only changes when the API is redeployed with other keys
const usePaymentMode = () =>
  useApiQuery<PaymentMode>(["payments", "mode"], { url: "/payments/mode" }, { staleTime: Infinity, retry: false });

/**
 * Next to a paid ticket, while payments run on Stripe's test keys: nobody is
 * charged, and which card to use. Shows nothing with real payments.
 */
export function TestCardNote({ className }: { className?: string }) {
  const mode = usePaymentMode();
  if (!mode.data?.testMode) return null;
  return (
    <p className={cn("flex items-start gap-2 rounded-lg bg-cobalt-50 p-3 text-sm text-cobalt-800", className)}>
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Test payments: nobody is charged. At checkout, use the card{" "}
        <span className="font-semibold tabular-nums whitespace-nowrap">4242 4242 4242 4242</span>, any future date and any
        three-digit code.
      </span>
    </p>
  );
}
