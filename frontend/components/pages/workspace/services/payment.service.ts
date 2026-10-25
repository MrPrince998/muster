import { request } from "@/lib/api/client";
import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";
import type { DirectPayment, PendingDirectPayment } from "@/types/event.interface";
import { eventsKey } from "./event.service";

export type PaymentMethod = "stripe" | "direct";

/** GET /orgs/:orgId/payments: whether the workspace can sell tickets, and how it's paid. */
export interface PaymentStatus {
  // this Muster offers Stripe; paying the organisers directly is always on offer
  available: boolean;
  // how buyers pay: through Stripe, or to the organisers directly
  method: PaymentMethod;
  // the workspace has started connecting a Stripe account
  connected: boolean;
  // events can have a price: Stripe can take payments, or the workspace has said how to pay it directly
  ready: boolean;
  // what tickets are priced in, the way it's paid now
  currency: string | null;
  // paying directly: how, and how long a place waits for its payment
  direct: { currency: string | null; instructions: string | null; qrUrl: string | null; holdHours: number };
}

/** Currencies a workspace can be paid directly in (ones with cents, or paisa). */
export const DIRECT_CURRENCIES = [
  "npr", "inr", "bdt", "pkr", "lkr", "usd", "eur", "gbp", "aud", "cad", "nzd", "sgd", "myr", "php", "zar", "kes", "ngn",
] as const;

const key = (orgId: string) => ["orgs", orgId, "payments"];

export const usePaymentStatus = (orgId: string) =>
  useApiQuery<PaymentStatus>(key(orgId), { url: `/orgs/${orgId}/payments` });

/** Asks Stripe again (coming back from its sign-up). */
export const useRefreshPayments = (orgId: string) =>
  useApiMutation<PaymentStatus, void>({ method: "post", url: `/orgs/${orgId}/payments/refresh` }, { invalidates: [key(orgId)] });

/** How buyers pay: through Stripe, or to the organisers directly (with how, in what currency, for how long). */
export const useUpdatePaymentSettings = (orgId: string) =>
  useApiMutation<
    PaymentStatus,
    { method?: PaymentMethod; currency?: string; instructions?: string; holdHours?: number }
  >({ method: "patch", url: `/orgs/${orgId}/payments` }, { invalidates: [key(orgId)] });

/** Puts up the workspace's payment QR code (the image itself), or takes it down. */
export const setPaymentQr = (orgId: string, image: Blob | null) =>
  request<PaymentStatus>(
    image
      ? { method: "put", url: `/orgs/${orgId}/payments/qr`, data: image, headers: { "Content-Type": image.type } }
      : { method: "delete", url: `/orgs/${orgId}/payments/qr` },
  );

/** Stripe's sign-up for the workspace's account, or its dashboard: where to send the browser. */
export const paymentsRedirect = (orgId: string, to: "connect" | "dashboard") =>
  request<{ url: string }>({ method: "post", url: `/orgs/${orgId}/payments/${to}` });

/**
 * Gets a ticket at an event with ticket types: Stripe's checkout page when
 * it costs something (`url`); the place held and how to pay the organisers
 * (`payment`) when they're paid directly; or the place straight away
 * (`registered`) when it comes to nothing (a free ticket, or a code).
 */
export const getTicket = (
  clubId: string,
  eventId: string,
  body: { answers?: Record<string, string>; ticketTypeId?: string; code?: string },
) =>
  request<{ url: string | null; registered: boolean; payment: DirectPayment | null }>({
    method: "post",
    url: `/clubs/${clubId}/events/${eventId}/checkout`,
    data: body,
  });

/** Gives up a place held while you pay the organisers, before paying. */
export const useGiveUpHold = (clubId: string, eventId: string) =>
  useApiMutation<void, void>(
    { method: "delete", url: `/clubs/${clubId}/events/${eventId}/checkout` },
    { invalidates: [eventsKey(clubId)] },
  );

const directKey = (clubId: string, eventId: string) => [...eventsKey(clubId), eventId, "direct-payments"];

/** An event's payments waiting for an organiser to confirm, oldest first. */
export const useDirectPayments = (clubId: string, eventId: string, enabled = true) =>
  useApiQuery<PendingDirectPayment[]>(
    directKey(clubId, eventId),
    { url: `/clubs/${clubId}/events/${eventId}/direct-payments` },
    { enabled },
  );

/** The money arrived (the place and ticket are theirs), or it didn't (the place goes back on offer). */
export const useDecidePayment = (clubId: string, eventId: string) =>
  useApiMutation<void, { checkoutId: string; decision: "confirm" | "decline" }>(
    ({ checkoutId, decision }) => ({
      method: "post",
      url: `/clubs/${clubId}/events/${eventId}/direct-payments/${checkoutId}/${decision}`,
    }),
    { invalidates: [eventsKey(clubId)] },
  );
