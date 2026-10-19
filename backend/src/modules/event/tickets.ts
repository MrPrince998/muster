import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';

/**
 * Ticket types and discount codes (migration TicketTypes). An event with no
 * types is free; with types, everyone taking a place takes one of them,
 * and a code can take money off a paid one. Everything that takes a place
 * (registering, buying, the waitlist, guests) decides what it costs here.
 */

export interface TicketTypeRow {
  id: string;
  name: string;
  price_cents: number;
  capacity: number | null;
  members_only: boolean;
  sales_end_at: Date | null;
  position: number;
}

/** What someone chose: a type (needed when there's more than one on offer) and maybe a code. */
export interface TicketChoice {
  ticketTypeId?: string;
  code?: string;
}

export interface ResolvedTicket {
  // null: an event without types (free)
  type: TicketTypeRow | null;
  discountCodeId: string | null;
  // what they pay: the type's price, less the code's discount
  priceCents: number;
}

// Stripe's smallest charge: a discount never leaves a paid ticket costing less (it's free, or this)
const MIN_CHARGE = 50;

export const MAX_TICKET_TYPES = 10;

/** An event's types, in the order the organiser set. */
export function ticketTypes(m: EntityManager, eventId: string): Promise<TicketTypeRow[]> {
  return m.query(
    `SELECT id, name, price_cents, capacity, members_only, sales_end_at, position
     FROM ticket_types WHERE event_id = $1 ORDER BY position, created_at`,
    [eventId],
  );
}

/**
 * Which ticket someone gets and what it costs, inside the caller's
 * transaction (with the event locked): the type they chose (or the only
 * one on offer), on sale, with one left; and their code, if any, valid and
 * not used up. People's own pending checkouts don't count against them.
 * Guests (`member: false`) can't have members-only types.
 */
export async function resolveTicket(
  m: EntityManager,
  place: { eventId: string; userId: string; member: boolean; choice?: TicketChoice; ignoreCapacity?: boolean },
): Promise<ResolvedTicket> {
  const types = await ticketTypes(m, place.eventId);
  if (types.length === 0) return { type: null, discountCodeId: null, priceCents: 0 };

  const offered = types.filter((t) => place.member || !t.members_only);
  const wanted = place.choice?.ticketTypeId;
  const type = wanted ? offered.find((t) => t.id === wanted) : offered.length === 1 ? offered[0] : undefined;
  if (!type) {
    throw wanted
      ? HttpError.badRequest('No such ticket for this event', 'TICKET_TYPE_NOT_FOUND')
      : HttpError.badRequest('Choose a ticket', 'TICKET_TYPE_REQUIRED');
  }
  if (type.sales_end_at && type.sales_end_at <= new Date()) {
    throw HttpError.conflict(`"${type.name}" tickets are no longer on sale`, 'TICKET_SALES_ENDED');
  }
  if (type.capacity !== null && !place.ignoreCapacity) {
    const [{ taken }]: { taken: number }[] = await m.query(
      `SELECT ((SELECT count(*) FROM registrations WHERE ticket_type_id = $1 AND cancelled_at IS NULL AND user_id <> $2)
             + (SELECT count(*) FROM checkouts
                WHERE ticket_type_id = $1 AND status = 'pending' AND expires_at > now() AND user_id <> $2))::int AS taken`,
      [type.id, place.userId],
    );
    if (taken >= type.capacity) throw HttpError.conflict(`"${type.name}" tickets have sold out`, 'TICKET_TYPE_SOLD_OUT');
  }

  const code = place.choice?.code?.trim();
  if (!code) return { type, discountCodeId: null, priceCents: type.price_cents };
  const discount = await findCode(m, place.eventId, code, place.userId);
  if (!discount) throw HttpError.badRequest("That code doesn't work for this event", 'CODE_NOT_VALID');
  return { type, discountCodeId: discount.id, priceCents: discounted(type.price_cents, discount) };
}

/** A price with a code's discount taken off: free, or at least Stripe's smallest charge. */
export function discounted(priceCents: number, code: { percent_off: number | null; amount_off_cents: number | null }): number {
  if (priceCents === 0) return 0;
  const left =
    code.percent_off !== null
      ? Math.round((priceCents * (100 - code.percent_off)) / 100)
      : Math.max(0, priceCents - (code.amount_off_cents ?? 0));
  return left === 0 ? 0 : Math.max(MIN_CHARGE, left);
}

// a code that's on, not past its end, and with a use left (places and open checkouts count; theirs doesn't)
async function findCode(
  m: EntityManager,
  eventId: string,
  code: string,
  userId: string,
): Promise<{ id: string; percent_off: number | null; amount_off_cents: number | null } | null> {
  const [row]: { id: string; percent_off: number | null; amount_off_cents: number | null; max_uses: number | null; used: number }[] =
    await m.query(
      `SELECT d.id, d.percent_off, d.amount_off_cents, d.max_uses,
              ((SELECT count(*) FROM registrations r WHERE r.discount_code_id = d.id AND r.cancelled_at IS NULL AND r.user_id <> $3)
             + (SELECT count(*) FROM checkouts c
                WHERE c.discount_code_id = d.id AND c.status = 'pending' AND c.expires_at > now() AND c.user_id <> $3))::int AS used
       FROM discount_codes d
       WHERE d.event_id = $1 AND d.code = upper($2) AND d.active AND (d.expires_at IS NULL OR d.expires_at > now())
       FOR UPDATE`,
      [eventId, code, userId],
    );
  if (!row || (row.max_uses !== null && row.used >= row.max_uses)) return null;
  return row;
}

/**
 * The types as the organiser set them, checked: up to ten, names unique,
 * prices free or at least 0.50, limits positive. A type that existed keeps
 * its id (and its sales).
 */
export function checkTicketTypes(
  input: { id?: string; name: string; priceCents: number; capacity?: number | null; membersOnly?: boolean; salesEndAt?: string | null }[],
): { id?: string; name: string; priceCents: number; capacity: number | null; membersOnly: boolean; salesEndAt: Date | null }[] {
  if (input.length > MAX_TICKET_TYPES) {
    throw HttpError.badRequest(`Up to ${MAX_TICKET_TYPES} ticket types`, 'TOO_MANY_TICKET_TYPES');
  }
  const names = new Set<string>();
  return input.map((t) => {
    const name = t.name.trim();
    if (names.has(name.toLowerCase())) throw HttpError.badRequest(`Two tickets are called "${name}"`, 'TICKET_NAME_TAKEN');
    names.add(name.toLowerCase());
    if (t.priceCents !== 0 && t.priceCents < MIN_CHARGE) {
      throw HttpError.badRequest('A paid ticket costs at least 0.50', 'PRICE_TOO_LOW');
    }
    return {
      ...(t.id && { id: t.id }),
      name,
      priceCents: t.priceCents,
      capacity: t.capacity ?? null,
      membersOnly: !!t.membersOnly,
      salesEndAt: t.salesEndAt ? new Date(t.salesEndAt) : null,
    };
  });
}

/**
 * Replaces an event's types with `wanted`, inside the caller's transaction:
 * types kept by id are updated, new ones added, and ones left out removed,
 * unless someone already has (or is buying) one: then it stays and this
 * says so (stop selling it with an end date instead).
 */
export async function saveTicketTypes(
  m: EntityManager,
  orgId: string,
  eventId: string,
  wanted: ReturnType<typeof checkTicketTypes>,
): Promise<void> {
  const current = await ticketTypes(m, eventId);
  const kept = new Set(wanted.filter((t) => t.id).map((t) => t.id!));
  for (const gone of current.filter((t) => !kept.has(t.id))) {
    const [{ used }]: { used: number }[] = await m.query(
      `SELECT ((SELECT count(*) FROM registrations WHERE ticket_type_id = $1)
             + (SELECT count(*) FROM checkouts WHERE ticket_type_id = $1)
             + (SELECT count(*) FROM waitlist_entries WHERE ticket_type_id = $1))::int AS used`,
      [gone.id],
    );
    if (used > 0) {
      throw HttpError.conflict(
        `People already have "${gone.name}" tickets: end its sales instead of removing it`,
        'TICKET_TYPE_HAS_SALES',
      );
    }
    await m.query(`DELETE FROM ticket_types WHERE id = $1`, [gone.id]);
  }
  const known = new Set(current.map((t) => t.id));
  for (const [position, t] of wanted.entries()) {
    if (t.id && known.has(t.id)) {
      await m.query(
        `UPDATE ticket_types SET name = $2, price_cents = $3, capacity = $4, members_only = $5, sales_end_at = $6, position = $7
         WHERE id = $1`,
        [t.id, t.name, t.priceCents, t.capacity, t.membersOnly, t.salesEndAt, position],
      );
    } else {
      await m.query(
        `INSERT INTO ticket_types (org_id, event_id, name, price_cents, capacity, members_only, sales_end_at, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [orgId, eventId, t.name, t.priceCents, t.capacity, t.membersOnly, t.salesEndAt, position],
      );
    }
  }
}

/** Whether any of an event's types costs money: such an event sells its places (no waitlist). */
export const PAID_EVENT = (alias: string) =>
  `EXISTS (SELECT 1 FROM ticket_types tt WHERE tt.event_id = ${alias}.id AND tt.price_cents > 0)`;
