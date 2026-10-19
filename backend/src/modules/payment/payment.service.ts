import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';
import { audit, AuditAction } from '../audit/audit.js';
import { BULK_PACE_MS, EmailService } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import type { OrgMembership } from '../organisation/org-roles.js';
import type { ClubAccess } from '../permission/club-access.js';
import { checkPlace } from '../registration/place.js';
import { TicketService } from '../ticket/ticket.service.js';
import { PaymentGateway, type PaymentEvent } from './payment-gateway.js';

// how long a checkout holds its place (Stripe's shortest session)
const HOLD_MINUTES = 30;

const notReady = () =>
  HttpError.conflict("This workspace can't take payments yet: connect Stripe in Settings", 'PAYMENTS_NOT_SET_UP');

export interface PaymentStatus {
  // this Muster takes payments at all (Stripe keys are set)
  available: boolean;
  // the workspace has started connecting its Stripe account
  connected: boolean;
  // ...and Stripe says it can take payments
  ready: boolean;
  currency: string | null;
}

interface PaidRow {
  registration_id: string;
  event_id: string;
  event_title: string;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  club_name: string;
  attendee_name: string;
  email: string;
  guest: boolean;
  time_zone: string;
}

/**
 * Paid tickets, through Stripe Connect (README: "Payments"). Each workspace
 * connects its own Stripe account; a ticket's money goes there, less
 * Muster's fee, and refunds come back out of it.
 *
 * Buying: a checkout row holds a place for half an hour (the event locked
 * while it's made, so two people can't take the last seat), then Stripe's
 * signed webhook says it's paid and the place becomes theirs, ticket and
 * all. A webhook can arrive twice, or after the event was cancelled: the
 * checkout row makes the first one count and refunds a payment there's no
 * place for any more.
 *
 * Refunds: giving a place back before the event's cut-off refunds it in
 * full; cancelling an event refunds everyone. Refunds carry an idempotency
 * key per place, so however often they're tried, the money moves once.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly tenant: TenantService,
    private readonly gateway: PaymentGateway,
    private readonly tickets: TicketService,
    private readonly email: EmailService,
    @Inject(BULK_PACE_MS) private readonly paceMs: number,
  ) {}

  // --- the workspace's account ---------------------------------------------------------

  /** Whether the workspace can sell tickets. Any member may ask (it says nothing secret). */
  status(me: OrgMembership): Promise<PaymentStatus> {
    return this.tenant.withTenant(me.orgId, (m) => this.statusIn(m, me.orgId));
  }

  /**
   * Starts (or continues) connecting the workspace's Stripe account: a link
   * to Stripe's own sign-up, which comes back to Settings.
   */
  async connect(me: OrgMembership): Promise<{ url: string }> {
    if (!this.gateway.enabled) throw HttpError.serviceUnavailable("Payments aren't set up on this Muster", 'PAYMENTS_UNAVAILABLE');
    const { accountId, slug } = await this.tenant.withTenant(me.orgId, async (m) => {
      const [org]: { name: string; slug: string; stripe_account_id: string | null }[] = await m.query(
        `SELECT name, slug, stripe_account_id FROM organisations WHERE id = $1 FOR UPDATE`,
        [me.orgId],
      );
      let accountId = org.stripe_account_id;
      if (!accountId) {
        // users is global (no RLS): the person connecting is Stripe's first contact
        const [{ email }]: { email: string }[] = await m.query(`SELECT email FROM users WHERE id = $1`, [me.userId]);
        accountId = await this.gateway.createAccount({ orgId: me.orgId, name: org.name, email });
        await m.query(`UPDATE organisations SET stripe_account_id = $2 WHERE id = $1`, [me.orgId, accountId]);
        await audit(m, { actorId: me.userId, action: AuditAction.PaymentsConnected });
      }
      return { accountId, slug: org.slug };
    });
    const settings = new URL(`/o/${slug}/settings`, config.appUrl);
    settings.searchParams.set('stripe', 'return');
    const refresh = new URL(`/o/${slug}/settings`, config.appUrl);
    refresh.searchParams.set('stripe', 'refresh');
    return { url: await this.gateway.onboardingLink(accountId, settings.toString(), refresh.toString()) };
  }

  /** Asks Stripe again (after onboarding, or if a webhook went missing). */
  async refresh(me: OrgMembership): Promise<PaymentStatus> {
    const accountId = await this.tenant.withTenant(me.orgId, async (m) => {
      const [org]: { stripe_account_id: string | null }[] = await m.query(
        `SELECT stripe_account_id FROM organisations WHERE id = $1`,
        [me.orgId],
      );
      return org.stripe_account_id;
    });
    if (accountId && this.gateway.enabled) {
      const account = await this.gateway.account(accountId);
      await this.tenant.withTenant(me.orgId, (m) =>
        m.query(`UPDATE organisations SET payments_enabled = $2, currency = COALESCE($3, currency) WHERE id = $1`, [
          me.orgId,
          account.chargesEnabled,
          account.currency,
        ]),
      );
    }
    return this.status(me);
  }

  /** A one-time link into the workspace's Stripe dashboard: payouts, payments, refunds. */
  async dashboard(me: OrgMembership): Promise<{ url: string }> {
    const accountId = await this.tenant.withTenant(me.orgId, async (m) => {
      const [org]: { stripe_account_id: string | null }[] = await m.query(
        `SELECT stripe_account_id FROM organisations WHERE id = $1`,
        [me.orgId],
      );
      return org.stripe_account_id;
    });
    if (!accountId) throw notReady();
    return { url: await this.gateway.dashboardLink(accountId) };
  }

  /** The price an event can be given: only in a workspace that can take payments, in its currency. */
  async priceFor(m: EntityManager, orgId: string, priceCents: number | null): Promise<{ priceCents: number | null; currency: string | null }> {
    if (priceCents === null) return { priceCents: null, currency: null };
    const status = await this.statusIn(m, orgId);
    if (!status.available || !status.ready || !status.currency) throw notReady();
    return { priceCents, currency: status.currency };
  }

  // --- buying a place ----------------------------------------------------------------

  /**
   * Starts paying for a place, inside the caller's tenant transaction:
   * checks a place is free (the event locked), holds it, and returns
   * Stripe's checkout page. Asking again while a checkout is still open
   * returns the same one.
   */
  async startCheckout(
    m: EntityManager,
    place: { orgId: string; eventId: string; userId: string; clubId?: string; publicOnly?: boolean },
    back: { successUrl: string; cancelUrl: string },
  ): Promise<{ url: string }> {
    const { event, existing } = await checkPlace(m, place);
    if (existing) throw HttpError.conflict("You're already registered", 'ALREADY_REGISTERED');
    if (event.price_cents === null || !event.currency) throw HttpError.conflict('This event is free: register instead', 'EVENT_IS_FREE');

    const [open]: { url: string | null }[] = await m.query(
      `SELECT url FROM checkouts WHERE event_id = $1 AND user_id = $2 AND status = 'pending' AND expires_at > now() + interval '2 minutes'`,
      [place.eventId, place.userId],
    );
    if (open?.url) return { url: open.url };

    const [details]: { title: string; starts_at: Date; ends_at: Date; club_name: string; email: string; time_zone: string; stripe_account_id: string | null; payments_enabled: boolean }[] =
      await m.query(
        `SELECT e.title, e.starts_at, e.ends_at, c.name AS club_name, u.email, o.time_zone, o.stripe_account_id, o.payments_enabled
         FROM events e JOIN clubs c ON c.id = e.club_id JOIN organisations o ON o.id = e.org_id, users u
         WHERE e.id = $1 AND u.id = $2`,
        [place.eventId, place.userId],
      );
    if (!details.stripe_account_id || !details.payments_enabled) throw notReady();

    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
    const [{ id }]: { id: string }[] = await m.query(
      `INSERT INTO checkouts (org_id, event_id, user_id, amount_cents, currency, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [place.orgId, place.eventId, place.userId, event.price_cents, event.currency, expiresAt],
    );
    const session = await this.gateway.createCheckout({
      checkoutId: id,
      orgId: place.orgId,
      accountId: details.stripe_account_id,
      currency: event.currency,
      amountCents: event.price_cents,
      feeCents: Math.round((event.price_cents * config.payments.platformFeePercent) / 100),
      title: details.title,
      description: `${details.club_name}, ${formatWhen(details.starts_at, details.ends_at, details.time_zone)}`,
      email: details.email,
      successUrl: back.successUrl,
      cancelUrl: back.cancelUrl,
      expiresAt,
    });
    await m.query(`UPDATE checkouts SET session_id = $2, url = $3 WHERE id = $1`, [id, session.sessionId, session.url]);
    return { url: session.url };
  }

  /** A member buying a place: Stripe's checkout page, coming back to the event. */
  async memberCheckout(access: ClubAccess, eventId: string): Promise<{ url: string }> {
    const orgId = await this.tenant.orgIdForClub(access.clubId);
    if (!orgId) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
    return this.tenant.withTenant(orgId, async (m) => {
      const [org]: { slug: string }[] = await m.query(`SELECT slug FROM organisations WHERE id = $1`, [orgId]);
      const back = (paid: '1' | '0') => {
        const url = new URL(`/o/${org.slug}`, config.appUrl);
        url.searchParams.set('club', access.clubId);
        url.searchParams.set('event', eventId);
        url.searchParams.set('paid', paid);
        return url.toString();
      };
      return this.startCheckout(
        m,
        { orgId, eventId, userId: access.userId, clubId: access.clubId },
        { successUrl: back('1'), cancelUrl: back('0') },
      );
    });
  }

  // --- what Stripe tells us ------------------------------------------------------------

  /** A webhook: checks its signature, then acts on it. Safe to receive twice. */
  async webhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
    let event: PaymentEvent;
    try {
      if (!rawBody || !signature) throw new Error('missing body or signature');
      event = this.gateway.parseWebhook(rawBody, signature);
    } catch (error) {
      this.logger.warn(`Refused a payment webhook: ${error instanceof Error ? error.message : error}`);
      throw HttpError.badRequest('Not a valid webhook', 'INVALID_WEBHOOK');
    }
    switch (event.type) {
      case 'checkout.completed':
        return this.completed(event);
      case 'checkout.expired':
        await this.tenant.withTenant(event.orgId, (m) =>
          m.query(`UPDATE checkouts SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [event.checkoutId]),
        );
        return;
      case 'account.updated':
        await this.tenant.withTenant(event.orgId, (m) =>
          m.query(
            `UPDATE organisations SET payments_enabled = $3, currency = COALESCE($4, currency)
             WHERE id = $1 AND stripe_account_id = $2`,
            [event.orgId, event.accountId, event.chargesEnabled, event.currency],
          ),
        );
        return;
      default:
        return;
    }
  }

  // Paid: the held place becomes theirs (or, if the event can't have them any more, the money goes back)
  private async completed(event: Extract<PaymentEvent, { type: 'checkout.completed' }>): Promise<void> {
    const outcome = await this.tenant.withTenant(event.orgId, async (m) => {
      const [checkout]: { event_id: string; user_id: string; amount_cents: number; currency: string; status: string }[] =
        await m.query(`SELECT event_id, user_id, amount_cents, currency, status FROM checkouts WHERE id = $1 FOR UPDATE`, [
          event.checkoutId,
        ]);
      // a repeat (or not ours): nothing more to do
      if (!checkout || checkout.status === 'paid' || checkout.status === 'refunded') return null;
      const [ev]: { status: string; ends_at: Date }[] = await m.query(`SELECT status, ends_at FROM events WHERE id = $1 FOR UPDATE`, [
        checkout.event_id,
      ]);
      // paid for an event that's since been cancelled or ended: no place to give
      if (!ev || ev.status !== 'published' || ev.ends_at <= new Date()) {
        await m.query(`UPDATE checkouts SET status = 'refunded' WHERE id = $1`, [event.checkoutId]);
        return { refund: true as const };
      }
      // the place was held for them (even if the hold just ran out: they paid in Stripe's time)
      const [row]: { id: string }[] = await m.query(
        `INSERT INTO registrations (org_id, event_id, user_id, amount_paid_cents, currency, payment_intent_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT registrations_event_id_user_id_key
         DO UPDATE SET cancelled_at = NULL, amount_paid_cents = $4, currency = $5, payment_intent_id = $6, refunded_at = NULL
         RETURNING id`,
        [event.orgId, checkout.event_id, checkout.user_id, checkout.amount_cents, checkout.currency, event.paymentIntentId],
      );
      await m.query(`UPDATE checkouts SET status = 'paid', registration_id = $2 WHERE id = $1`, [event.checkoutId, row.id]);
      const [ticket]: PaidRow[] = await m.query(`${SELECT_PAID} WHERE r.id = $1`, [row.id]);
      return { ticket };
    });
    if (!outcome) return;
    if ('refund' in outcome) {
      await this.gateway.refund(event.paymentIntentId, `refund-checkout-${event.checkoutId}`);
      this.logger.log(`Refunded checkout ${event.checkoutId}: the event can't take them any more`);
      return;
    }
    this.email.inBackground('ticket', this.emailTicket(outcome.ticket));
  }

  // --- refunds -----------------------------------------------------------------------

  /**
   * Refunds a place given back, inside the caller's transaction, if it was
   * paid for and it's before the event's cut-off. If Stripe can't do it, the
   * giving back fails too (try again), so nobody loses a place and the money.
   * Returns what was refunded, if anything.
   */
  async refundIfDue(m: EntityManager, registrationId: string): Promise<number | null> {
    const [row]: { amount_paid_cents: number | null; payment_intent_id: string | null; refunded_at: Date | null; starts_at: Date; refund_cutoff_hours: number }[] =
      await m.query(
        `SELECT r.amount_paid_cents, r.payment_intent_id, r.refunded_at, e.starts_at, e.refund_cutoff_hours
         FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.id = $1`,
        [registrationId],
      );
    if (!row?.payment_intent_id || !row.amount_paid_cents || row.refunded_at) return null;
    if (Date.now() > row.starts_at.getTime() - row.refund_cutoff_hours * 3_600_000) return null;
    await this.gateway.refund(row.payment_intent_id, `refund-${registrationId}`);
    await m.query(`UPDATE registrations SET refunded_at = now() WHERE id = $1`, [registrationId]);
    return row.amount_paid_cents;
  }

  /**
   * An event was cancelled: everyone who paid gets their money back, one at
   * a time at the provider's pace. Each refund records itself, so running it
   * again (after a failure) only does the ones still owed.
   */
  async refundEvent(orgId: string, eventId: string): Promise<void> {
    const owed: { id: string; payment_intent_id: string }[] = await this.tenant.withTenant(orgId, (m) =>
      m.query(
        `SELECT id, payment_intent_id FROM registrations
         WHERE event_id = $1 AND payment_intent_id IS NOT NULL AND refunded_at IS NULL AND cancelled_at IS NULL`,
        [eventId],
      ),
    );
    for (const [index, place] of owed.entries()) {
      if (index > 0 && this.paceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
      try {
        await this.gateway.refund(place.payment_intent_id, `refund-${place.id}`);
        await this.tenant.withTenant(orgId, (m) => m.query(`UPDATE registrations SET refunded_at = now() WHERE id = $1`, [place.id]));
      } catch (error) {
        this.logger.error(`Refund for ${place.id} failed`, error instanceof Error ? error.stack : error);
      }
    }
    if (owed.length > 0) this.logger.log(`Refunded ${owed.length} place${owed.length === 1 ? '' : 's'} for cancelled event ${eventId}`);
  }

  // --- helpers -----------------------------------------------------------------------

  private async statusIn(m: EntityManager, orgId: string): Promise<PaymentStatus> {
    const [org]: { stripe_account_id: string | null; payments_enabled: boolean; currency: string | null }[] = await m.query(
      `SELECT stripe_account_id, payments_enabled, currency FROM organisations WHERE id = $1`,
      [orgId],
    );
    return {
      available: this.gateway.enabled,
      connected: !!org.stripe_account_id,
      ready: this.gateway.enabled && org.payments_enabled,
      currency: org.currency,
    };
  }

  private async emailTicket(row: PaidRow): Promise<void> {
    const token = await this.tickets.sign(row.registration_id, row.event_id, row.ends_at);
    await this.email.sendTicket({
      to: row.email,
      registrationId: row.registration_id,
      // a guest's way back to the ticket is its own page
      guestToken: row.guest ? token : undefined,
      name: row.attendee_name,
      eventTitle: row.event_title,
      clubName: row.club_name,
      when: formatWhen(row.starts_at, row.ends_at, row.time_zone),
      where: row.location,
      qrPng: await this.tickets.qrPng(token),
      calendar: { eventId: row.event_id, startsAt: row.starts_at, endsAt: row.ends_at },
    });
  }
}

const SELECT_PAID = `
  SELECT r.id AS registration_id, e.id AS event_id, e.title AS event_title, e.starts_at, e.ends_at, e.location,
         c.name AS club_name, u.name AS attendee_name, u.email, (u.password_hash IS NULL) AS guest, o.time_zone
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN clubs c ON c.id = e.club_id
  JOIN organisations o ON o.id = r.org_id
  JOIN users u ON u.id = r.user_id`;
