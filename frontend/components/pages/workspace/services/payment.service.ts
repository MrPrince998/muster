import { request } from "@/lib/api/client";
import { useApiMutation } from "@/lib/api/useApiMutation";
import { useApiQuery } from "@/lib/api/useApiQuery";

/** GET /orgs/:orgId/payments: whether the workspace can sell tickets. */
export interface PaymentStatus {
  // this Muster takes payments at all
  available: boolean;
  // the workspace has started connecting a Stripe account
  connected: boolean;
  // Stripe says it can take payments: events can have a price
  ready: boolean;
  currency: string | null;
}

const key = (orgId: string) => ["orgs", orgId, "payments"];

export const usePaymentStatus = (orgId: string) =>
  useApiQuery<PaymentStatus>(key(orgId), { url: `/orgs/${orgId}/payments` });

/** Asks Stripe again (coming back from its sign-up). */
export const useRefreshPayments = (orgId: string) =>
  useApiMutation<PaymentStatus, void>({ method: "post", url: `/orgs/${orgId}/payments/refresh` }, { invalidates: [key(orgId)] });

/** Stripe's sign-up for the workspace's account, or its dashboard: where to send the browser. */
export const paymentsRedirect = (orgId: string, to: "connect" | "dashboard") =>
  request<{ url: string }>({ method: "post", url: `/orgs/${orgId}/payments/${to}` });

/** Starts buying a place at a paid event: Stripe's checkout page. */
export const startCheckout = (clubId: string, eventId: string) =>
  request<{ url: string }>({ method: "post", url: `/clubs/${clubId}/events/${eventId}/checkout` });
