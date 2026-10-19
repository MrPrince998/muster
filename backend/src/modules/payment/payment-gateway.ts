import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { HttpError } from '../../common/errors/http-error.js';

/** What a checkout charges, and where the money goes. */
export interface CheckoutRequest {
  checkoutId: string;
  orgId: string;
  // the workspace's connected account: the money's destination
  accountId: string;
  currency: string;
  amountCents: number;
  // Muster's share, kept from the payment
  feeCents: number;
  title: string;
  description: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

/** A webhook, reduced to what Muster acts on. */
export type PaymentEvent =
  | { type: 'checkout.completed'; orgId: string; checkoutId: string; sessionId: string; paymentIntentId: string }
  | { type: 'checkout.expired'; orgId: string; checkoutId: string; sessionId: string }
  | { type: 'account.updated'; orgId: string; accountId: string; chargesEnabled: boolean; currency: string | null }
  | { type: 'ignored' };

export interface AccountStatus {
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  currency: string | null;
}

const unavailable = () =>
  HttpError.serviceUnavailable("Payments aren't set up on this Muster", 'PAYMENTS_UNAVAILABLE');

/**
 * Where payments go. An abstract class, so tests (and development without
 * Stripe keys) swap the provider without touching the rest; everything
 * Stripe-shaped stays in here.
 */
export abstract class PaymentGateway {
  // whether this Muster takes payments at all
  abstract readonly enabled: boolean;
  // development only: checkout is skipped and every payment succeeds at once
  readonly paysAtOnce: boolean = false;
  abstract createAccount(account: { orgId: string; name: string; email: string }): Promise<string>;
  abstract onboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  abstract account(accountId: string): Promise<AccountStatus>;
  abstract dashboardLink(accountId: string): Promise<string>;
  abstract createCheckout(request: CheckoutRequest): Promise<{ sessionId: string; url: string }>;
  // the whole payment back; the same key never refunds twice
  abstract refund(paymentIntentId: string, idempotencyKey: string): Promise<void>;
  // checks the signature, then reads it; throws on a forged or garbled one
  abstract parseWebhook(rawBody: Buffer, signature: string): PaymentEvent;
}

/**
 * Stripe Connect with Express accounts and destination charges: the
 * workspace's account receives each payment, less Muster's fee, and a refund
 * takes it back from there (and the fee with it).
 */
export class StripeGateway extends PaymentGateway {
  readonly enabled = true;

  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {
    super();
  }

  async createAccount({ orgId, name, email }: { orgId: string; name: string; email: string }): Promise<string> {
    const account = await this.stripe.accounts.create(
      { type: 'express', email, business_profile: { name }, metadata: { orgId } },
      { idempotencyKey: `account-${orgId}` },
    );
    return account.id;
  }

  async onboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return link.url;
  }

  async account(accountId: string): Promise<AccountStatus> {
    const account = await this.stripe.accounts.retrieve(accountId);
    return {
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
      currency: account.default_currency ?? null,
    };
  }

  async dashboardLink(accountId: string): Promise<string> {
    return (await this.stripe.accounts.createLoginLink(accountId)).url;
  }

  async createCheckout(r: CheckoutRequest): Promise<{ sessionId: string; url: string }> {
    const metadata = { orgId: r.orgId, checkoutId: r.checkoutId };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: r.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: r.currency,
              unit_amount: r.amountCents,
              product_data: { name: r.title, description: r.description },
            },
          },
        ],
        payment_intent_data: {
          transfer_data: { destination: r.accountId },
          ...(r.feeCents > 0 && { application_fee_amount: r.feeCents }),
          metadata,
        },
        metadata,
        success_url: r.successUrl,
        cancel_url: r.cancelUrl,
        expires_at: Math.floor(r.expiresAt.getTime() / 1000),
      },
      { idempotencyKey: `checkout-${r.checkoutId}` },
    );
    return { sessionId: session.id, url: session.url! };
  }

  async refund(paymentIntentId: string, idempotencyKey: string): Promise<void> {
    await this.stripe.refunds.create(
      { payment_intent: paymentIntentId, reverse_transfer: true, refund_application_fee: true },
      { idempotencyKey },
    );
  }

  parseWebhook(rawBody: Buffer, signature: string): PaymentEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (session.payment_status !== 'paid' || !session.metadata?.orgId) return { type: 'ignored' };
        return {
          type: 'checkout.completed',
          orgId: session.metadata.orgId,
          checkoutId: session.metadata.checkoutId,
          sessionId: session.id,
          paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent!.id,
        };
      }
      case 'checkout.session.expired': {
        const session = event.data.object;
        if (!session.metadata?.orgId) return { type: 'ignored' };
        return { type: 'checkout.expired', orgId: session.metadata.orgId, checkoutId: session.metadata.checkoutId, sessionId: session.id };
      }
      case 'account.updated': {
        const account = event.data.object;
        if (!account.metadata?.orgId) return { type: 'ignored' };
        return {
          type: 'account.updated',
          orgId: account.metadata.orgId,
          accountId: account.id,
          chargesEnabled: account.charges_enabled,
          currency: account.default_currency ?? null,
        };
      }
      default:
        return { type: 'ignored' };
    }
  }
}

/** No Stripe keys: payments are off, and asking for one says so. */
export class DisabledGateway extends PaymentGateway {
  readonly enabled = false;
  createAccount(): Promise<string> {
    return Promise.reject(unavailable());
  }
  onboardingLink(): Promise<string> {
    return Promise.reject(unavailable());
  }
  account(): Promise<AccountStatus> {
    return Promise.reject(unavailable());
  }
  dashboardLink(): Promise<string> {
    return Promise.reject(unavailable());
  }
  createCheckout(): Promise<{ sessionId: string; url: string }> {
    return Promise.reject(unavailable());
  }
  refund(): Promise<void> {
    return Promise.reject(unavailable());
  }
  parseWebhook(): PaymentEvent {
    throw unavailable();
  }
}

/**
 * A stand-in for Stripe, for tests: accounts are ready at once, checkouts
 * get a made-up URL, and webhooks are the JSON body itself (signature
 * "test"). It remembers every refund, so tests can see them.
 */
export class FakeGateway extends PaymentGateway {
  readonly enabled = true;
  // PAYMENTS_FAKE: no checkout page, straight back to the event, paid
  override readonly paysAtOnce: boolean;

  constructor({ paysAtOnce = false } = {}) {
    super();
    this.paysAtOnce = paysAtOnce;
  }
  readonly refunds = new Map<string, string>();
  readonly checkouts: CheckoutRequest[] = [];
  chargesEnabled = true;

  createAccount(): Promise<string> {
    return Promise.resolve(`acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`);
  }
  onboardingLink(accountId: string, returnUrl: string): Promise<string> {
    // nothing to sign up for: straight back
    if (this.paysAtOnce) return Promise.resolve(returnUrl);
    return Promise.resolve(`https://connect.stripe.test/${accountId}?return=${encodeURIComponent(returnUrl)}`);
  }
  account(): Promise<AccountStatus> {
    return Promise.resolve({ chargesEnabled: this.chargesEnabled, detailsSubmitted: true, currency: 'aud' });
  }
  dashboardLink(accountId: string): Promise<string> {
    return Promise.resolve(this.paysAtOnce ? 'https://dashboard.stripe.com/test' : `https://dashboard.stripe.test/${accountId}`);
  }
  createCheckout(request: CheckoutRequest): Promise<{ sessionId: string; url: string }> {
    this.checkouts.push(request);
    const sessionId = `cs_test_${request.checkoutId}`;
    if (this.paysAtOnce) return Promise.resolve({ sessionId, url: request.successUrl });
    return Promise.resolve({ sessionId, url: `https://checkout.stripe.test/${sessionId}` });
  }
  refund(paymentIntentId: string, idempotencyKey: string): Promise<void> {
    // the same key twice is one refund, as at Stripe
    this.refunds.set(idempotencyKey, paymentIntentId);
    return Promise.resolve();
  }
  parseWebhook(rawBody: Buffer, signature: string): PaymentEvent {
    if (signature !== 'test') throw new Error('No signatures found matching the expected signature for payload');
    return JSON.parse(rawBody.toString('utf8')) as PaymentEvent;
  }
}
