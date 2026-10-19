import { HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { EventStatus } from '../event/entities/event.entity.js';
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
}

export interface OpenEvent {
  status: EventStatus;
  ends_at: Date;
  capacity: number | null;
  registration_closed_at: Date | null;
  visibility: string;
  price_cents: number | null;
  currency: string | null;
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
    `SELECT status, ends_at, capacity, registration_closed_at, visibility, price_cents, currency FROM events
     WHERE id = $1 AND ($2::uuid IS NULL OR club_id = $2) FOR UPDATE`,
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
 * Takes a free event's place for someone, inside the caller's tenant
 * transaction: the event row is locked (checkPlace), so the capacity check
 * and the insert can't interleave with another registration (README:
 * "Concurrency-safe operations"). A paid event's places are bought instead
 * (PaymentService). Registering again after cancelling reactivates the same
 * row, so the ticket id stays the same.
 */
export async function takePlace(
  m: EntityManager,
  place: PlaceRequest,
): Promise<{ id: string; event_id: string; created_at: Date; isNew: boolean }> {
  const { event, existing } = await checkPlace(m, place);
  if (existing) return { id: existing.id, event_id: place.eventId, created_at: existing.created_at, isNew: false };
  if (event.price_cents !== null) throw paymentRequired();

  const [row]: { id: string; event_id: string; created_at: Date }[] = await m.query(
    `INSERT INTO registrations (org_id, event_id, user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT registrations_event_id_user_id_key
     DO UPDATE SET cancelled_at = NULL
     RETURNING id, event_id, created_at`,
    [place.orgId, place.eventId, place.userId],
  );
  return { ...row, isNew: true };
}

