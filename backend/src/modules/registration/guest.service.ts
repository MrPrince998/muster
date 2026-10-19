import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { fileSlug } from '../../common/utils/csv.js';
import { buildIcs } from '../../common/utils/ics.js';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';
import { EmailService } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import { eventNotFound } from '../event/event.service.js';
import { normalizeEmail } from '../user/entities/user.entity.js';
import type { GuestPlaceResultDto, PublicEventDto } from './dto/public.dto.js';
import type { TicketWithCodeDto } from './dto/ticket.dto.js';
import { takePlace, toTicket, type TicketRow } from './registration.service.js';
import { TicketService } from '../ticket/ticket.service.js';
import { freePlaces, lockEvent, waitingCount, WaitlistService } from '../waitlist/waitlist.service.js';
import { PaymentService } from '../payment/payment.service.js';

const ticketNotFound = () =>
  HttpError.notFound('This ticket was cancelled, or the link is wrong', 'TICKET_NOT_FOUND');
const badLink = () =>
  HttpError.badRequest("This link doesn't work. It may be over a day old; ask for a place again", 'INVALID_TOKEN');

interface PublicEventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: Date;
  ends_at: Date;
  status: 'published' | 'cancelled';
  cancel_reason: string | null;
  ended: boolean;
  registration_closed_at: Date | null;
  capacity: number | null;
  registered: number;
  // places held by people paying for them right now
  held: number;
  waiting: number;
  price_cents: number | null;
  currency: string | null;
  club_name: string;
  org_name: string;
  time_zone: string;
}

// a public event (never a draft or a members-only one); $1 the event
const SELECT_PUBLIC_EVENT = `
  SELECT e.id, e.title, e.description, e.location, e.starts_at, e.ends_at, e.status, e.cancel_reason,
         e.ends_at <= now() AS ended, e.registration_closed_at, e.capacity,
         (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.cancelled_at IS NULL)::int AS registered,
         (SELECT count(*) FROM checkouts h
           WHERE h.event_id = e.id AND h.status = 'pending' AND h.expires_at > now())::int AS held,
         (SELECT count(*) FROM waitlist_entries w WHERE w.event_id = e.id AND w.promoted_at IS NULL)::int AS waiting,
         e.price_cents, e.currency, c.name AS club_name, o.name AS org_name, o.time_zone
  FROM events e
  JOIN clubs c ON c.id = e.club_id
  JOIN organisations o ON o.id = e.org_id
  WHERE e.id = $1 AND e.visibility = 'public' AND e.status <> 'draft'`;

// one ticket by its registration, for its own page; $1 registration, $2 event
const SELECT_TICKET = `
  SELECT r.id AS registration_id, e.id AS event_id, c.id AS club_id, c.name AS club_name,
         o.name AS org_name, o.slug AS org_slug, e.title AS event_title, e.starts_at, e.ends_at,
         e.location, e.status AS event_status, u.name AS attendee_name, r.checked_in_at, u.email, o.time_zone
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN clubs c ON c.id = e.club_id
  JOIN organisations o ON o.id = r.org_id
  JOIN users u ON u.id = r.user_id
  WHERE r.id = $1 AND r.event_id = $2 AND r.cancelled_at IS NULL`;

/**
 * Public events and their guests (README: "Joining"). Anyone with the link can
 * see a public event and ask for a place with a name and an email; the place
 * is only taken when they confirm from that inbox, so nobody can fill an
 * event with made-up addresses or spend a place in someone else's name.
 * Guests are users without a password: they can't sign in, so their ticket's
 * own signed token is the key to its page. Signing up later with the same
 * email turns the guest into a full account, tickets and all.
 */
@Injectable()
export class GuestService {
  constructor(
    private readonly tenant: TenantService,
    private readonly tickets: TicketService,
    private readonly email: EmailService,
    private readonly waitlist: WaitlistService,
    private readonly payments: PaymentService,
  ) {}

  /** A public event's page. Drafts and members-only events are "not found". */
  event(eventId: string): Promise<PublicEventDto> {
    return this.inEvent(eventId, async (m) => toPublicEvent(await this.publicEvent(m, eventId)));
  }

  /** A public event as a calendar file: a plain link anyone can open. */
  calendar(eventId: string): Promise<{ filename: string; ics: string }> {
    return this.inEvent(eventId, async (m) => {
      const event = await this.publicEvent(m, eventId);
      const url = new URL(`/e/${eventId}`, config.appUrl).toString();
      return {
        filename: `${fileSlug(event.title)}.ics`,
        ics: buildIcs({
          eventId,
          title: event.title,
          startsAt: event.starts_at,
          endsAt: event.ends_at,
          location: event.location,
          description: `${event.club_name}, ${event.org_name}. ${url}`,
          url,
          cancelled: event.status === 'cancelled',
        }),
      };
    });
  }

  /**
   * Asks for a place: checks the event can take one, then emails a link to
   * confirm it. Nothing is held until the link is used. The answer is the
   * same whether or not the address has an account or a place already.
   */
  async requestPlace(eventId: string, guest: { name: string; email: string }): Promise<void> {
    const event = await this.inEvent(eventId, (m) => this.publicEvent(m, eventId));
    assertTakingPlaces(event);
    // full (or people already waiting): the link joins the waitlist instead
    const full = (event.capacity !== null && event.registered + event.held >= event.capacity) || event.waiting > 0;
    // a paid event has no waitlist: a place frees up for whoever buys it first
    if (full && event.price_cents !== null) throw HttpError.conflict('This event is sold out', 'SOLD_OUT');
    const email = normalizeEmail(guest.email);
    const token = await this.tickets.signGuestConfirmation({ eventId, email, name: guest.name });
    this.email.inBackground(
      'guest confirmation',
      this.email.sendGuestConfirmation({
        to: email,
        eventId,
        token,
        name: guest.name,
        eventTitle: event.title,
        clubName: event.club_name,
        when: formatWhen(event.starts_at, event.ends_at, event.time_zone),
        waitlist: full,
      }),
    );
  }

  /**
   * Uses a confirmation link: takes the place (once, however often it's
   * clicked) and emails the ticket. Returns the ticket, whose token opens it.
   */
  async confirmPlace(eventId: string, token: string): Promise<GuestPlaceResultDto> {
    const claims = await this.tickets.verifyGuestConfirmation(token);
    if (!claims || claims.eventId !== eventId) throw badLink();

    const outcome = await this.inEvent(eventId, async (m, orgId) => {
      const userId = await this.guestUser(m, claims.email, claims.name);
      // locked here and again in takePlace (same transaction): nothing slips in between
      const event = await lockEvent(m, eventId);
      const already: { id: string }[] = await m.query(
        `SELECT id FROM registrations WHERE event_id = $1 AND user_id = $2 AND cancelled_at IS NULL`,
        [eventId, userId],
      );
      const full =
        !!event &&
        already.length === 0 &&
        ((await freePlaces(m, eventId, event.capacity)) === 0 || (await waitingCount(m, eventId)) > 0);
      if (full && event.visibility === 'public' && event.status === 'published' && event.ends_at > new Date() && event.registration_closed_at === null) {
        if (event.price_cents !== null) throw HttpError.conflict('This event is sold out', 'SOLD_OUT');
        return { waitlistPosition: await this.waitlist.join(m, { orgId, eventId, userId }) };
      }
      // a paid event: the place is held while they pay, and the ticket comes once Stripe says so
      if (event?.price_cents != null && already.length === 0) {
        const page = new URL(`/e/${eventId}`, config.appUrl);
        const back = (paid: '1' | '0') => {
          page.searchParams.set('paid', paid);
          return page.toString();
        };
        const { url, checkoutId } = await this.payments.startCheckout(
          m,
          { orgId, eventId, userId, publicOnly: true },
          { successUrl: back('1'), cancelUrl: back('0') },
        );
        return { checkoutUrl: url, checkoutId, orgId };
      }
      const place = await takePlace(m, { orgId, eventId, userId, publicOnly: true, alreadyOk: true });
      const [row]: (TicketRow & { email: string })[] = await m.query(SELECT_TICKET, [place.id, eventId]);
      return { ticket: row, isNew: place.isNew };
    });

    if ('waitlistPosition' in outcome) return { waitlistPosition: outcome.waitlistPosition };
    if ('checkoutUrl' in outcome) {
      await this.payments.afterCheckout(outcome.orgId, outcome.checkoutId);
      return { checkoutUrl: outcome.checkoutUrl };
    }
    const { ticket, isNew } = outcome;
    const ticketToken = await this.tickets.sign(ticket.registration_id, eventId, ticket.ends_at);
    if (isNew) this.email.inBackground('ticket', this.emailTicket(ticket, ticketToken));
    return { ticketToken };
  }

  /** A ticket's page, opened by its own signed token. */
  async ticket(token: string): Promise<TicketWithCodeDto> {
    const ids = await this.tickets.verify(token);
    if (!ids) throw ticketNotFound();
    const row = await this.inEvent(
      ids.eventId,
      async (m) => {
        const [found]: TicketRow[] = await m.query(SELECT_TICKET, [ids.registrationId, ids.eventId]);
        return found;
      },
      ticketNotFound,
    );
    if (!row) throw ticketNotFound();
    return { ...toTicket(row), token, qrSvg: await this.tickets.qrSvg(token) };
  }

  /** Gives the place back, from the ticket's page. Not once checked in. */
  async cancelTicket(token: string): Promise<void> {
    const ids = await this.tickets.verify(token);
    if (!ids) throw ticketNotFound();
    const orgId = await this.tenant.orgIdForEvent(ids.eventId);
    await this.inEvent(
      ids.eventId,
      async (m) => {
        const [cancelled]: [unknown[], number] = await m.query(
          `UPDATE registrations SET cancelled_at = now()
           WHERE id = $1 AND event_id = $2 AND cancelled_at IS NULL AND checked_in_at IS NULL
           RETURNING id`,
          [ids.registrationId, ids.eventId],
        );
        if (cancelled.length > 0) {
          await this.payments.refundIfDue(m, ids.registrationId);
          return;
        }
        const [row]: { checked_in_at: Date | null }[] = await m.query(
          `SELECT checked_in_at FROM registrations WHERE id = $1 AND cancelled_at IS NULL`,
          [ids.registrationId],
        );
        if (row?.checked_in_at) {
          throw HttpError.conflict("You've been checked in, so the place can't be given back", 'ALREADY_CHECKED_IN');
        }
        throw ticketNotFound();
      },
      ticketNotFound,
    );
    // the freed place goes to whoever has waited longest
    if (orgId) await this.waitlist.promote(orgId, ids.eventId);
  }

  // --- helpers ---------------------------------------------------------------

  // the event's workspace (RLS), found from its public id
  private async inEvent<T>(
    eventId: string,
    work: (m: EntityManager, orgId: string) => Promise<T>,
    notFound: () => HttpError = eventNotFound,
  ): Promise<T> {
    const orgId = await this.tenant.orgIdForEvent(eventId);
    if (!orgId) throw notFound();
    return this.tenant.withTenant(orgId, (m) => work(m, orgId));
  }

  private async publicEvent(m: EntityManager, eventId: string): Promise<PublicEventRow> {
    const [row]: PublicEventRow[] = await m.query(SELECT_PUBLIC_EVENT, [eventId]);
    if (!row) throw eventNotFound();
    return row;
  }

  // the user with this email, or a new guest (no password) if there's none;
  // safe when two confirmations race: the unique email decides, then we read it
  private async guestUser(m: EntityManager, email: string, name: string): Promise<string> {
    await m.query(
      `INSERT INTO users (email, name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
      [email, name],
    );
    const [user]: { id: string }[] = await m.query(`SELECT id FROM users WHERE email = $1`, [email]);
    return user.id;
  }

  private async emailTicket(row: TicketRow & { email: string }, token: string): Promise<void> {
    await this.email.sendTicket({
      to: row.email,
      registrationId: row.registration_id,
      guestToken: token,
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

function toPublicEvent(row: PublicEventRow): PublicEventDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    cancelReason: row.cancel_reason,
    ended: row.ended,
    registrationOpen: row.registration_closed_at === null,
    // while people are waiting, a free place is theirs, not the public's
    placesLeft: row.capacity === null ? null : row.waiting > 0 ? 0 : Math.max(0, row.capacity - row.registered - row.held),
    waitlistCount: row.waiting,
    clubName: row.club_name,
    workspaceName: row.org_name,
    // the workspace's: where the event happens
    timeZone: row.time_zone,
    price: row.price_cents !== null && row.currency ? { amountCents: row.price_cents, currency: row.currency } : null,
  };
}

// the same refusals registering gives, up front, before an email goes out
function assertTakingPlaces(event: PublicEventRow): void {
  if (event.status !== 'published') {
    throw HttpError.conflict('This event is not open for registration', 'EVENT_NOT_OPEN');
  }
  if (event.ended) throw HttpError.conflict('This event has ended', 'EVENT_ENDED');
  if (event.registration_closed_at !== null) {
    throw HttpError.conflict('Registration for this event is closed', 'REGISTRATION_CLOSED');
  }
}
