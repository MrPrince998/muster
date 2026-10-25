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
import { checkAnswers } from '../event/questions.js';
import { checkPlace, insertPlace } from '../registration/place.js';
import { resolveTicket, type TicketChoice } from '../event/tickets.js';
import { TicketService } from '../ticket/ticket.service.js';
import { PaymentGateway, type PaymentEvent } from './payment-gateway.js';
import { FileStorage } from '../files/file-storage.js';
import { type DirectPayment, directPayment, newReference } from './direct-payment.js';

// how long a checkout holds its place (Stripe's shortest session)
const HOLD_MINUTES = 30;

export const notReady = () =>
  HttpError.conflict("This workspace can't take payments yet: set up payments in Settings", 'PAYMENTS_NOT_SET_UP');

export type PaymentMethod = 'stripe' | 'direct';

export interface PaymentStatus {
  // this Muster offers Stripe (its keys are set); paying directly is always on offer
  available: boolean;
  // how the workspace's buyers pay: through Stripe, or to the organisers directly
  method: PaymentMethod;
  // the workspace has started connecting its Stripe account
  connected: boolean;
  // events can have a price: Stripe says the account can take payments, or
  // the workspace has said how to pay it directly
  ready: boolean;
  // what its tickets are priced in, the way it's paid now
  currency: string | null;
  // paying directly: how, and how long a place waits for its payment
  direct: { currency: string | null; instructions: string | null; qrUrl: string | null; holdHours: number };
}

/** Someone's place held while they pay the organisers, and who to tell. */
interface PayDirectlyRow {
  email: string;
  name: string;
  guest: boolean;
  event_id: string;
  event_title: string;
  starts_at: Date;
  ends_at: Date;
  club_id: string;
  club_name: string;
  org_slug: string;
  time_zone: string;
  qr_key: string | null;
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
    private readonly files: FileStorage,
    @Inject(BULK_PACE_MS) private readonly paceMs: number,
  ) {}

  /** Whether this Muster takes payments, and whether they're for real (Stripe's live keys). */
  mode(): { enabled: boolean; testMode: boolean } {
    return { enabled: this.gateway.enabled, testMode: this.gateway.enabled && this.gateway.testMode };
  }

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

  /**
   * The currency for an event's tickets: none if they're all free; if any
   * costs money, the workspace must be able to take payments, and it's the
   * workspace's currency.
   */
  async currencyFor(m: EntityManager, orgId: string, paid: boolean): Promise<string | null> {
    if (!paid) return null;
    const status = await this.statusIn(m, orgId);
    if (!status.ready || !status.currency) throw notReady();
    return status.currency;
  }

  // --- buying a place ----------------------------------------------------------------

  /**
   * Starts buying a place, inside the caller's tenant transaction: checks a
   * place (and that ticket) is free, the event locked, works out the price
   * with any code, holds the place, and returns Stripe's checkout page.
   * Asking again while a checkout is still open returns the same one. A
   * ticket that comes to nothing (a free type, or a 100% code) is simply
   * theirs: `registrationId`, no Stripe.
   */
  async startCheckout(
    m: EntityManager,
    place: {
      orgId: string;
      eventId: string;
      userId: string;
      clubId?: string;
      publicOnly?: boolean;
      answers?: Record<string, unknown>;
      choice?: TicketChoice;
    },
    back: { successUrl: string; cancelUrl: string },
  ): Promise<{ url: string; checkoutId?: string } | { registrationId: string } | { direct: DirectPayment }> {
    const { event, existing } = await checkPlace(m, place);
    if (existing) throw HttpError.conflict("You're already registered", 'ALREADY_REGISTERED');
    const ticket = await resolveTicket(m, { ...place, member: !place.publicOnly });
    if (!ticket.type) throw HttpError.conflict('This event is free: register instead', 'EVENT_IS_FREE');
    const answers = checkAnswers(event.questions ?? [], place.answers);
    if (ticket.priceCents === 0) {
      const row = await insertPlace(m, place, { ticket, answers });
      return { registrationId: row.id };
    }
    if (!event.currency) throw notReady();

    const [org]: { payment_method: PaymentMethod; direct_instructions: string | null; direct_hold_hours: number }[] = await m.query(
      `SELECT payment_method, direct_instructions, direct_hold_hours FROM organisations WHERE id = $1`,
      [place.orgId],
    );
    if (org.payment_method === 'direct') return { direct: await this.holdForDirect(m, place, { event, ticket, answers, org }) };

    const [open]: { id: string; url: string | null }[] = await m.query(
      `SELECT id, url FROM checkouts
       WHERE event_id = $1 AND user_id = $2 AND method = 'stripe' AND status = 'pending' AND expires_at > now() + interval '2 minutes'`,
      [place.eventId, place.userId],
    );
    if (open?.url) {
      // the same checkout (and price), with the latest answers
      await m.query(`UPDATE checkouts SET answers = $2 WHERE id = $1`, [open.id, JSON.stringify(answers)]);
      return { url: open.url };
    }

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
      `INSERT INTO checkouts
         (org_id, event_id, user_id, amount_cents, currency, expires_at, answers, ticket_type_id, discount_code_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        place.orgId,
        place.eventId,
        place.userId,
        ticket.priceCents,
        event.currency,
        expiresAt,
        JSON.stringify(answers),
        ticket.type.id,
        ticket.discountCodeId,
      ],
    );
    const session = await this.gateway.createCheckout({
      checkoutId: id,
      orgId: place.orgId,
      accountId: details.stripe_account_id,
      currency: event.currency,
      amountCents: ticket.priceCents,
      feeCents: Math.round((ticket.priceCents * config.payments.platformFeePercent) / 100),
      title: `${details.title}: ${ticket.type.name}`,
      description: `${details.club_name}, ${formatWhen(details.starts_at, details.ends_at, details.time_zone)}`,
      email: details.email,
      successUrl: back.successUrl,
      cancelUrl: back.cancelUrl,
      expiresAt,
    });
    await m.query(`UPDATE checkouts SET session_id = $2, url = $3 WHERE id = $1`, [id, session.sessionId, session.url]);
    return { url: session.url, checkoutId: id };
  }

  /**
   * Holds a place while someone pays the organisers directly (the caller has
   * checked it's free, the event locked): for the workspace's hold time, or
   * until the event ends if that's sooner, with a reference for the payment.
   * Asking again while it's held gives the same one back, with the latest answers.
   */
  private async holdForDirect(
    m: EntityManager,
    place: { orgId: string; eventId: string; userId: string },
    { event, ticket, answers, org }: {
      event: { ends_at: Date; currency: string | null };
      ticket: { type: { id: string } | null; discountCodeId: string | null; priceCents: number };
      answers: Record<string, string>;
      org: { direct_instructions: string | null; direct_hold_hours: number };
    },
  ): Promise<DirectPayment> {
    if (!org.direct_instructions) throw notReady();
    const [held]: { id: string }[] = await m.query(
      `SELECT id FROM checkouts
       WHERE event_id = $1 AND user_id = $2 AND method = 'direct' AND status = 'pending' AND expires_at > now()`,
      [place.eventId, place.userId],
    );
    if (held) {
      await m.query(`UPDATE checkouts SET answers = $2 WHERE id = $1`, [held.id, JSON.stringify(answers)]);
      return directPayment(m, held.id);
    }
    const expiresAt = new Date(Math.min(Date.now() + org.direct_hold_hours * 3_600_000, event.ends_at.getTime()));
    const [{ id }]: { id: string }[] = await m.query(
      `INSERT INTO checkouts
         (org_id, event_id, user_id, amount_cents, currency, expires_at, answers, ticket_type_id, discount_code_id, method, reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'direct', $10) RETURNING id`,
      [
        place.orgId,
        place.eventId,
        place.userId,
        ticket.priceCents,
        event.currency,
        expiresAt,
        JSON.stringify(answers),
        ticket.type?.id ?? null,
        ticket.discountCodeId,
        newReference(),
      ],
    );
    return directPayment(m, id);
  }

  /**
   * Emails someone how to pay the organisers for the place just held for
   * them (once it's committed), with the workspace's QR code if it has one.
   */
  async emailPayDirectly(orgId: string, payment: DirectPayment): Promise<void> {
    const [row]: PayDirectlyRow[] = await this.tenant.withTenant(orgId, (m) =>
      m.query(
        `SELECT u.email, u.name, (u.password_hash IS NULL) AS guest, e.id AS event_id, e.title AS event_title,
                e.starts_at, e.ends_at, c.id AS club_id, c.name AS club_name, o.slug AS org_slug, o.time_zone,
                o.direct_qr_key AS qr_key
         FROM checkouts h
         JOIN users u ON u.id = h.user_id
         JOIN events e ON e.id = h.event_id
         JOIN clubs c ON c.id = e.club_id
         JOIN organisations o ON o.id = h.org_id
         WHERE h.id = $1`,
        [payment.checkoutId],
      ),
    );
    if (!row) return;
    this.email.inBackground(
      'pay directly',
      (async () => {
        const qr = row.qr_key ? await this.files.get(row.qr_key) : null;
        await this.email.sendPayDirectly({
          to: row.email,
          checkoutId: payment.checkoutId,
          qr: qr && row.qr_key ? { filename: `payment-qr.${row.qr_key.split('.').pop()}`, content: await streamToBuffer(qr.stream) } : null,
          link: { guest: row.guest, orgSlug: row.org_slug, clubId: row.club_id, eventId: row.event_id },
          name: row.name,
          eventTitle: row.event_title,
          clubName: row.club_name,
          when: formatWhen(row.starts_at, row.ends_at, row.time_zone),
          amount: formatAmount(payment.amountCents, payment.currency),
          instructions: payment.instructions,
          reference: payment.reference,
          heldUntil: formatMoment(payment.expiresAt, row.time_zone),
        });
      })(),
    );
  }

  /**
   * A member getting a ticket: Stripe's checkout page, coming back to the
   * event; or, if it comes to nothing, the place straight away (and its
   * ticket by email); or, when the workspace is paid directly, the place
   * held and how to pay for it (by email too).
   */
  async memberCheckout(
    access: ClubAccess,
    eventId: string,
    answers?: Record<string, unknown>,
    choice?: TicketChoice,
  ): Promise<{ url: string | null; registered: boolean; payment: DirectPayment | null }> {
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
        { orgId, eventId, userId: access.userId, clubId: access.clubId, answers, choice },
        { successUrl: back('1'), cancelUrl: back('0') },
      );
    }).then(async (outcome) => {
      if ('registrationId' in outcome) {
        await this.ticketFor(orgId, outcome.registrationId);
        return { url: null, registered: true, payment: null };
      }
      if ('direct' in outcome) {
        await this.emailPayDirectly(orgId, outcome.direct);
        return { url: null, registered: false, payment: outcome.direct };
      }
      await this.afterCheckout(orgId, outcome.checkoutId);
      return { url: outcome.url, registered: false, payment: null };
    });
  }

  /** Emails the ticket for a place just taken (one a code made free), once it's committed. */
  async ticketFor(orgId: string, registrationId: string): Promise<void> {
    const [ticket]: PaidRow[] = await this.tenant.withTenant(orgId, (m) => m.query(`${SELECT_PAID} WHERE r.id = $1`, [registrationId]));
    if (ticket) this.email.inBackground('ticket', this.emailTicket(ticket));
  }

  /**
   * Call once a new checkout is committed. Development's pretend Stripe
   * (PAYMENTS_FAKE) pays it then and there, through the same path a real
   * webhook takes; with real Stripe, this does nothing.
   */
  async afterCheckout(orgId: string | undefined, checkoutId: string | undefined): Promise<void> {
    if (!this.gateway.paysAtOnce || !orgId || !checkoutId) return;
    await this.completed({
      type: 'checkout.completed',
      orgId,
      checkoutId,
      sessionId: `cs_test_${checkoutId}`,
      paymentIntentId: `pi_fake_${checkoutId}`,
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
      const [checkout]: {
        event_id: string;
        user_id: string;
        amount_cents: number;
        currency: string;
        status: string;
        answers: Record<string, string>;
        ticket_type_id: string | null;
        discount_code_id: string | null;
      }[] = await m.query(
        `SELECT event_id, user_id, amount_cents, currency, status, answers, ticket_type_id, discount_code_id
         FROM checkouts WHERE id = $1 FOR UPDATE`,
        [
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
      const row = await insertPlace(
        m,
        { orgId: event.orgId, eventId: checkout.event_id, userId: checkout.user_id },
        {
          ticket: {
            type: checkout.ticket_type_id ? { id: checkout.ticket_type_id } : null,
            discountCodeId: checkout.discount_code_id,
          },
          answers: checkout.answers ?? {},
          payment: { amountCents: checkout.amount_cents, currency: checkout.currency, paymentIntentId: event.paymentIntentId },
        },
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

  async statusIn(m: EntityManager, orgId: string): Promise<PaymentStatus> {
    const [org]: {
      stripe_account_id: string | null;
      payments_enabled: boolean;
      currency: string | null;
      payment_method: PaymentMethod;
      direct_currency: string | null;
      direct_instructions: string | null;
      direct_qr_key: string | null;
      direct_hold_hours: number;
    }[] = await m.query(
      `SELECT stripe_account_id, payments_enabled, currency, payment_method,
              direct_currency, direct_instructions, direct_qr_key, direct_hold_hours
       FROM organisations WHERE id = $1`,
      [orgId],
    );
    const direct = org.payment_method === 'direct';
    return {
      available: this.gateway.enabled,
      method: org.payment_method,
      connected: !!org.stripe_account_id,
      ready: direct ? !!org.direct_instructions && !!org.direct_currency : this.gateway.enabled && org.payments_enabled,
      currency: direct ? org.direct_currency : org.currency,
      direct: {
        currency: org.direct_currency,
        instructions: org.direct_instructions,
        qrUrl: org.direct_qr_key ? `/files/${org.direct_qr_key}` : null,
        holdHours: org.direct_hold_hours,
      },
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

// "NPR 500.00": an amount as an email says it
export const formatAmount = (cents: number, currency: string) => `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;

// "Saturday 24 October, 18:30 (NPT)": a moment on the workspace's clock
export function formatMoment(at: Date, zone: string): string {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(at);
  return text.replace(/ at /, ', ').replace(/ ([A-Z]{2,5}|GMT[+-]\d+(:\d+)?)$/, ' ($1)');
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
