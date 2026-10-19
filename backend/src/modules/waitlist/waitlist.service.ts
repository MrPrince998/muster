import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { TenantService } from '../../database/tenant.service.js';
import { BULK_PACE_MS, EmailService } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import { TicketService } from '../ticket/ticket.service.js';

const eventNotFound = () => HttpError.notFound('Event not found', 'EVENT_NOT_FOUND');

interface LockedEvent {
  status: 'draft' | 'published' | 'cancelled';
  // set: a paid event, whose places are bought (no waitlist)
  price_cents: number | null;
  ends_at: Date;
  capacity: number | null;
  registration_closed_at: Date | null;
  visibility: string;
}

interface PromotedRow {
  registration_id: string;
  event_id: string;
  event_title: string;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  club_name: string;
  email: string;
  name: string;
  guest: boolean;
  time_zone: string;
}

/** Locks the event row (the same lock taking a place uses) and reads what decides who gets in. */
export async function lockEvent(
  m: EntityManager,
  eventId: string,
  clubId?: string,
): Promise<LockedEvent | undefined> {
  const [event]: LockedEvent[] = await m.query(
    `SELECT status, ends_at, capacity, registration_closed_at, visibility, price_cents FROM events
     WHERE id = $1 AND ($2::uuid IS NULL OR club_id = $2) FOR UPDATE`,
    [eventId, clubId ?? null],
  );
  return event;
}

/** How many are waiting. While anyone is, a freed place is theirs, not a newcomer's. */
export async function waitingCount(m: EntityManager, eventId: string): Promise<number> {
  const [{ count }]: { count: number }[] = await m.query(
    `SELECT count(*)::int AS count FROM waitlist_entries WHERE event_id = $1 AND promoted_at IS NULL`,
    [eventId],
  );
  return count;
}

// places held by someone paying for them right now (other than `$2`, when given)
const HELD = `(SELECT count(*) FROM checkouts c
               WHERE c.event_id = $1 AND c.status = 'pending' AND c.expires_at > now()
                 AND c.user_id IS DISTINCT FROM $2)`;

/**
 * Free places right now; null for no limit. A place someone is paying for
 * is taken until they've paid or their checkout runs out (`exceptUserId`'s
 * own isn't: it's the place they're about to take).
 */
export async function freePlaces(
  m: EntityManager,
  eventId: string,
  capacity: number | null,
  exceptUserId?: string,
): Promise<number | null> {
  if (capacity === null) return null;
  const [{ count }]: { count: number }[] = await m.query(
    `SELECT ((SELECT count(*) FROM registrations WHERE event_id = $1 AND cancelled_at IS NULL) + ${HELD})::int AS count`,
    [eventId, exceptUserId ?? null],
  );
  return Math.max(0, capacity - count);
}

/** Their place in the queue, from 1; null if they aren't waiting. */
export async function waitlistPosition(m: EntityManager, eventId: string, userId: string): Promise<number | null> {
  const [row]: { position: number | null }[] = await m.query(
    `SELECT (SELECT count(*) FROM waitlist_entries o
             WHERE o.event_id = w.event_id AND o.promoted_at IS NULL AND o.created_at <= w.created_at)::int AS position
     FROM waitlist_entries w
     WHERE w.event_id = $1 AND w.user_id = $2 AND w.promoted_at IS NULL`,
    [eventId, userId],
  );
  return row?.position ?? null;
}

/**
 * Waitlists for full events. People join when there's no place; whenever one
 * frees up (someone gives theirs back, the capacity goes up, registration
 * reopens) the person who has waited longest gets it, ticket and all,
 * without having to watch for it. If they can't make it, they give it back
 * and it moves on down the queue.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly tenant: TenantService,
    private readonly tickets: TicketService,
    private readonly email: EmailService,
    @Inject(BULK_PACE_MS) private readonly paceMs: number,
  ) {}

  /**
   * Joins the queue, inside the caller's transaction with the event locked.
   * Only when there's truly no place for them; safe to repeat. Returns their
   * position.
   */
  async join(m: EntityManager, place: { orgId: string; eventId: string; userId: string }): Promise<number> {
    const registered: unknown[] = await m.query(
      `SELECT 1 FROM registrations WHERE event_id = $1 AND user_id = $2 AND cancelled_at IS NULL`,
      [place.eventId, place.userId],
    );
    if (registered.length > 0) throw HttpError.conflict("You're already registered", 'ALREADY_REGISTERED');
    await m.query(
      `INSERT INTO waitlist_entries (org_id, event_id, user_id) VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) WHERE promoted_at IS NULL DO NOTHING`,
      [place.orgId, place.eventId, place.userId],
    );
    return (await waitlistPosition(m, place.eventId, place.userId))!;
  }

  /** Leaves the queue. */
  async leave(m: EntityManager, eventId: string, userId: string): Promise<void> {
    const [rows]: [unknown[], number] = await m.query(
      `DELETE FROM waitlist_entries WHERE event_id = $1 AND user_id = $2 AND promoted_at IS NULL RETURNING id`,
      [eventId, userId],
    );
    if (rows.length === 0) throw HttpError.notFound("You're not on the waitlist", 'NOT_WAITLISTED');
  }

  /**
   * Gives free places to the people who've waited longest, and emails them
   * their tickets. Call it after anything that can free a place, once that
   * change is committed. Does nothing unless the event is taking
   * registrations. Its own transaction, with the event locked, so two
   * promotions (or a promotion and a registration) can't hand out one place
   * twice.
   */
  async promote(orgId: string, eventId: string): Promise<void> {
    const promoted = await this.tenant.withTenant(orgId, async (m) => {
      const event = await lockEvent(m, eventId);
      if (!event) throw eventNotFound();
      // a paid event's places are bought, never handed out
      if (
        event.status !== 'published' ||
        event.ends_at <= new Date() ||
        event.registration_closed_at !== null ||
        event.price_cents !== null
      ) {
        return [];
      }
      const free = await freePlaces(m, eventId, event.capacity);
      if (free === 0) return [];

      const next: { id: string; user_id: string }[] = await m.query(
        `SELECT id, user_id FROM waitlist_entries WHERE event_id = $1 AND promoted_at IS NULL
         ORDER BY created_at, id ${free === null ? '' : 'LIMIT $2'}`,
        free === null ? [eventId] : [eventId, free],
      );
      const rows: PromotedRow[] = [];
      for (const entry of next) {
        const [registration]: { id: string }[] = await m.query(
          `INSERT INTO registrations (org_id, event_id, user_id) VALUES ($1, $2, $3)
           ON CONFLICT ON CONSTRAINT registrations_event_id_user_id_key DO UPDATE SET cancelled_at = NULL
           RETURNING id`,
          [orgId, eventId, entry.user_id],
        );
        await m.query(`UPDATE waitlist_entries SET promoted_at = now() WHERE id = $1`, [entry.id]);
        const [row]: PromotedRow[] = await m.query(
          `SELECT r.id AS registration_id, e.id AS event_id, e.title AS event_title, e.starts_at, e.ends_at,
                  e.location, c.name AS club_name, u.email, u.name, (u.password_hash IS NULL) AS guest, o.time_zone
           FROM registrations r JOIN events e ON e.id = r.event_id JOIN clubs c ON c.id = e.club_id
           JOIN users u ON u.id = r.user_id JOIN organisations o ON o.id = r.org_id
           WHERE r.id = $1`,
          [registration.id],
        );
        rows.push(row);
      }
      return rows;
    });

    if (promoted.length > 0) {
      this.logger.log(`${promoted.length} off the waitlist for event ${eventId}`);
      this.email.inBackground('waitlist ticket', this.emailTickets(promoted));
    }
  }

  // the tickets, one at a time at the provider's pace
  private async emailTickets(rows: PromotedRow[]): Promise<void> {
    for (const [index, row] of rows.entries()) {
      if (index > 0 && this.paceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
      const token = await this.tickets.sign(row.registration_id, row.event_id, row.ends_at);
      try {
        await this.email.sendTicket({
          to: row.email,
          registrationId: row.registration_id,
          guestToken: row.guest ? token : undefined,
          fromWaitlist: true,
          name: row.name,
          eventTitle: row.event_title,
          clubName: row.club_name,
          when: formatWhen(row.starts_at, row.ends_at, row.time_zone),
          where: row.location,
          qrPng: await this.tickets.qrPng(token),
          calendar: { eventId: row.event_id, startsAt: row.starts_at, endsAt: row.ends_at },
        });
      } catch (error) {
        // the place is theirs either way; the ticket is in the app (or on its page)
        this.logger.error(`Waitlist ticket email for ${row.registration_id} failed`, error instanceof Error ? error.stack : error);
      }
    }
  }
}
