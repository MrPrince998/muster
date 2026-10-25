import { HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { EventStatus } from '../event/entities/event.entity.js';
import { checkAnswers, type Question } from '../event/questions.js';
import { PAID_EVENT, resolveTicket, type TicketChoice } from '../event/tickets.js';
import { freePlaces, waitingCount } from '../waitlist/waitlist.service.js';

// (event.service has the same; not imported from there, which would tie this file to its module)
const eventNotFound = () => HttpError.notFound('Event not found', 'EVENT_NOT_FOUND');

export const paymentRequired = () =>
  new HttpError(HttpStatus.PAYMENT_REQUIRED, 'Places at this event are bought', 'PAYMENT_REQUIRED');

interface PlaceRequest {
  orgId: string;
  eventId: string;
  userId: string;
  clubId?: string;
  publicOnly?: boolean;
  alreadyOk?: boolean;
  // answers to the event's questions, checked against them
  answers?: Record<string, unknown>;
  // which ticket, and any discount code (events with ticket types)
  choice?: TicketChoice;
}

export interface OpenEvent {
  status: EventStatus;
  ends_at: Date;
  capacity: number | null;
  registration_closed_at: Date | null;
  visibility: string;
  // any of its ticket types costs money: places are bought (no waitlist)
  paid: boolean;
  currency: string | null;
  questions: Question[];
}

/**
 * Whether someone can have a place at an event right now, inside the
 * caller's tenant transaction, with the event row locked (so the answer
 * holds until the transaction ends): published, not over, open, and with a
 * place free (counting places held by people paying). Members come through
 * their club (`clubId`); guests through a public event's page
 * (`publicOnly`), where anything not public is "not found". With
 * `alreadyOk`, someone already registered gets their place back
 * (`existing`) instead of an error.
 */
export async function checkPlace(
  m: EntityManager,
  place: PlaceRequest,
): Promise<{ event: OpenEvent; existing: { id: string; created_at: Date } | null }> {
  const events: OpenEvent[] = await m.query(
    `SELECT e.status, e.ends_at, e.capacity, e.registration_closed_at, e.visibility, e.currency, e.questions,
            ${PAID_EVENT('e')} AS paid
     FROM events e
     WHERE e.id = $1 AND ($2::uuid IS NULL OR e.club_id = $2) FOR UPDATE OF e`,
    [place.eventId, place.clubId ?? null],
  );
  const event = events[0];
  // drafts are invisible to people registering; so is anything not public, from outside
  if (!event || event.status === EventStatus.Draft || (place.publicOnly && event.visibility !== 'public')) {
    throw eventNotFound();
  }

  const mine: { id: string; created_at: Date; cancelled_at: Date | null }[] = await m.query(
    `SELECT id, created_at, cancelled_at FROM registrations WHERE event_id = $1 AND user_id = $2`,
    [place.eventId, place.userId],
  );
  if (mine[0] && mine[0].cancelled_at === null) {
    if (place.alreadyOk) return { event, existing: { id: mine[0].id, created_at: mine[0].created_at } };
    throw HttpError.conflict("You're already registered", 'ALREADY_REGISTERED');
  }

  if (event.status !== EventStatus.Published) {
    throw HttpError.conflict('This event is not open for registration', 'EVENT_NOT_OPEN');
  }
  if (event.ends_at <= new Date()) {
    throw HttpError.conflict('This event has ended', 'EVENT_ENDED');
  }
  if (event.registration_closed_at !== null) {
    throw HttpError.conflict('Registration for this event is closed', 'REGISTRATION_CLOSED');
  }
  if ((await freePlaces(m, place.eventId, event.capacity, place.userId)) === 0) {
    throw HttpError.conflict('This event is full', 'EVENT_FULL');
  }
  // a place freed while people are waiting is theirs: no jumping the queue
  if ((await waitingCount(m, place.eventId)) > 0) {
    throw HttpError.conflict('This event is full', 'EVENT_FULL');
  }
  return { event, existing: null };
}

/**
 * Takes a place that costs nothing (a free event, a free ticket type, or
 * one a code makes free) for someone, inside the caller's tenant
 * transaction: the event row is locked (checkPlace), so the capacity check
 * and the insert can't interleave with another registration (README:
 * "Concurrency-safe operations"). A ticket that costs money is bought
 * instead (PaymentService). Registering again after cancelling reactivates
 * the same row, so the ticket id stays the same.
 */
export async function takePlace(
  m: EntityManager,
  place: PlaceRequest,
): Promise<{ id: string; event_id: string; created_at: Date; isNew: boolean }> {
  const { event, existing } = await checkPlace(m, place);
  if (existing) return { id: existing.id, event_id: place.eventId, created_at: existing.created_at, isNew: false };
  const ticket = await resolveTicket(m, { ...place, member: !place.publicOnly });
  if (ticket.priceCents > 0) throw paymentRequired();
  const answers = checkAnswers(event.questions ?? [], place.answers);
  return { ...(await insertPlace(m, place, { ticket, answers })), isNew: true };
}

/**
 * The place itself, inside the caller's transaction once everything's been
 * checked: new, or their earlier one back (same ticket id), with its ticket
 * type, code, answers and, if bought, the payment.
 */
export async function insertPlace(
  m: EntityManager,
  place: { orgId: string; eventId: string; userId: string },
  details: {
    ticket: { type: { id: string } | null; discountCodeId: string | null };
    answers: Record<string, string>;
    // through Stripe (its payment intent), or paid to the organisers directly
    payment?: { amountCents: number; currency: string; paymentIntentId: string | null; direct?: boolean };
  },
): Promise<{ id: string; event_id: string; created_at: Date }> {
  const [row]: { id: string; event_id: string; created_at: Date }[] = await m.query(
    `INSERT INTO registrations
       (org_id, event_id, user_id, answers, ticket_type_id, discount_code_id, amount_paid_cents, currency, payment_intent_id,
        paid_directly)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT ON CONSTRAINT registrations_event_id_user_id_key
     DO UPDATE SET cancelled_at = NULL, answers = $4, ticket_type_id = $5, discount_code_id = $6,
                   amount_paid_cents = $7, currency = $8, payment_intent_id = $9, refunded_at = NULL, paid_directly = $10
     RETURNING id, event_id, created_at`,
    [
      place.orgId,
      place.eventId,
      place.userId,
      JSON.stringify(details.answers),
      details.ticket.type?.id ?? null,
      details.ticket.discountCodeId,
      details.payment?.amountCents ?? null,
      details.payment?.currency ?? null,
      details.payment?.paymentIntentId ?? null,
      details.payment?.direct ?? false,
    ],
  );
  return row;
}

