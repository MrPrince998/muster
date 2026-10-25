import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { fileSlug, toCsv } from '../../common/utils/csv.js';
import { buildIcs } from '../../common/utils/ics.js';
import { prepareQuestions, type Question } from './questions.js';
import { checkTicketTypes, saveTicketTypes, ticketTypes } from './tickets.js';
import { occurrences, shiftLike } from '../../common/utils/recurrence.js';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';
import { EmailService, type EventRecipient } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import type { ClubAccess } from '../permission/club-access.js';
import { WaitlistService } from '../waitlist/waitlist.service.js';
import { FileStorage, imageKind } from '../files/file-storage.js';
import { PaymentService } from '../payment/payment.service.js';
import { Permission } from '../permission/permissions.js';
import type {
  CancelEventDto,
  CreateEventDto,
  EventAttendeeDto,
  EventDto,
  EventMessageDto,
  SendEventMessageDto,
  CreateDiscountCodeDto,
  DiscountCodeDto,
  EventScope,
  PastEventsPageDto,
  SeriesScope,
  UpdateEventDto,
} from './dto/event.dto.js';
import { EventStatus, EventVisibility, type RepeatEvery } from './entities/event.entity.js';
import { audit, AuditAction } from '../audit/audit.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';

// a cover image, after the browser has resized it
const MAX_COVER_BYTES = 2 * 1024 * 1024;

// an organiser's messages per event per day
const MESSAGES_PER_DAY = 10;

export const eventNotFound = () => HttpError.notFound('Event not found', 'EVENT_NOT_FOUND');
const missingPermission = (missing: Permission[]) =>
  HttpError.forbidden('Missing permission', 'MISSING_PERMISSION', { missing });

interface EventRow {
  id: string;
  club_id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: Date;
  ends_at: Date;
  capacity: number | null;
  visibility: EventVisibility;
  status: EventStatus;
  registration_closed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  registered_count: number;
  attended_count: number;
  youre_going: boolean;
  waitlist_count: number;
  waitlist_position: number | null;
  series_id: string | null;
  repeat_every: RepeatEvery | null;
  series_index: number;
  series_count: number;
  currency: string | null;
  ticket_types: {
    id: string;
    name: string;
    price_cents: number;
    capacity: number | null;
    members_only: boolean;
    sales_end_at: string | null;
    taken: number;
  }[];
  your_ticket_type: string | null;
  cover_image_key: string | null;
  refund_cutoff_hours: number;
  held_count: number;
  your_paid_cents: number | null;
  your_paid_currency: string | null;
  sales_cents: number;
  questions: Question[];
}

type ClubDetails = { name: string; orgSlug: string; timeZone: string };

// what an edit has to tell the people registered, once it's committed
interface EventChange {
  eventId: string;
  morePlaces: boolean;
  notify: {
    recipients: EventRecipient[];
    title: string;
    when: string;
    where: string | null;
    before: { when?: string; where?: string | null };
  } | null;
}

// Every event read goes through this, so counts and "am I going" are always
// computed the same way. $1 is the club, $2 the current user.
const SELECT_EVENTS = `
  SELECT
    e.id, e.club_id, e.created_by, e.title, e.description, e.location,
    e.starts_at, e.ends_at, e.capacity, e.visibility, e.status,
    e.registration_closed_at, e.cancelled_at, e.cancel_reason, e.series_id, e.repeat_every,
    (SELECT count(*) FROM events s
      WHERE s.series_id = e.series_id AND (s.starts_at, s.id) <= (e.starts_at, e.id))::int AS series_index,
    (SELECT count(*) FROM events s WHERE s.series_id = e.series_id)::int AS series_count,
    e.currency, e.refund_cutoff_hours, e.questions, e.cover_image_key,
    (SELECT coalesce(json_agg(json_build_object(
              'id', t.id, 'name', t.name, 'price_cents', t.price_cents, 'capacity', t.capacity,
              'members_only', t.members_only, 'sales_end_at', t.sales_end_at,
              'taken', (SELECT count(*) FROM registrations r WHERE r.ticket_type_id = t.id AND r.cancelled_at IS NULL)
                     + (SELECT count(*) FROM checkouts h
                        WHERE h.ticket_type_id = t.id AND h.status = 'pending' AND h.expires_at > now()))
            ORDER BY t.position, t.created_at), '[]')
     FROM ticket_types t WHERE t.event_id = e.id) AS ticket_types,
    (SELECT t.name FROM registrations r JOIN ticket_types t ON t.id = r.ticket_type_id
      WHERE r.event_id = e.id AND r.user_id = $2 AND r.cancelled_at IS NULL) AS your_ticket_type,
    (SELECT count(*) FROM checkouts h
      WHERE h.event_id = e.id AND h.status = 'pending' AND h.expires_at > now())::int AS held_count,
    (SELECT r.amount_paid_cents FROM registrations r
      WHERE r.event_id = e.id AND r.user_id = $2 AND r.cancelled_at IS NULL AND r.refunded_at IS NULL) AS your_paid_cents,
    (SELECT r.currency FROM registrations r
      WHERE r.event_id = e.id AND r.user_id = $2 AND r.cancelled_at IS NULL AND r.refunded_at IS NULL) AS your_paid_currency,
    (SELECT coalesce(sum(r.amount_paid_cents), 0) FROM registrations r
      WHERE r.event_id = e.id AND r.amount_paid_cents IS NOT NULL AND r.refunded_at IS NULL)::int AS sales_cents,
    (SELECT count(*) FROM registrations r
      WHERE r.event_id = e.id AND r.cancelled_at IS NULL)::int          AS registered_count,
    (SELECT count(*) FROM registrations r
      WHERE r.event_id = e.id AND r.checked_in_at IS NOT NULL)::int     AS attended_count,
    EXISTS (SELECT 1 FROM registrations r
      WHERE r.event_id = e.id AND r.user_id = $2 AND r.cancelled_at IS NULL) AS youre_going,
    (SELECT count(*) FROM waitlist_entries w
      WHERE w.event_id = e.id AND w.promoted_at IS NULL)::int           AS waitlist_count,
    (SELECT (SELECT count(*) FROM waitlist_entries o
               WHERE o.event_id = w.event_id AND o.promoted_at IS NULL AND o.created_at <= w.created_at)::int
       FROM waitlist_entries w
      WHERE w.event_id = e.id AND w.user_id = $2 AND w.promoted_at IS NULL) AS waitlist_position
  FROM events e
  WHERE e.club_id = $1`;

// the last event shown, to continue after: "<starts_at ISO>_<id>", base64url
const encodeEventCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}_${id}`).toString('base64url');

function decodeEventCursor(cursor: string): { at: string; id: string } | null {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('_');
  return at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
}

/** Whether this person may edit the event: any event, or their own. */
export function canManage(access: ClubAccess, createdBy: string | null): boolean {
  return (
    access.has(Permission.EventManageAny) ||
    (access.has(Permission.EventManageOwn) && createdBy === access.userId)
  );
}

@Injectable()
export class EventService {
  constructor(
    private readonly tenant: TenantService,
    private readonly email: EmailService,
    private readonly waitlist: WaitlistService,
    private readonly payments: PaymentService,
    private readonly files: FileStorage,
  ) {}

  /**
   * A club's events in one of three lists. Cancelled events stay listed (and
   * say so), so the people who were going see what happened. Drafts only include events you
   * could edit; members without event permissions get an empty list.
   */
  list(access: ClubAccess, scope: EventScope): Promise<EventDto[]> {
    return this.inClub(access, async (m) => {
      let where: string;
      const params: unknown[] = [access.clubId, access.userId];
      switch (scope) {
        case 'upcoming':
          where = `AND e.status IN ('published', 'cancelled') AND e.ends_at > now() ORDER BY e.starts_at`;
          break;
        case 'past':
          // the latest 50: pastPage() pages through the rest
          where = `AND e.status IN ('published', 'cancelled') AND e.ends_at <= now() ORDER BY e.starts_at DESC, e.id DESC LIMIT 50`;
          break;
        case 'drafts':
          if (access.has(Permission.EventManageAny)) {
            where = `AND e.status = 'draft' ORDER BY e.starts_at`;
          } else if (access.has(Permission.EventManageOwn)) {
            where = `AND e.status = 'draft' AND e.created_by = $2 ORDER BY e.starts_at`;
          } else {
            return [];
          }
          break;
      }
      const rows: EventRow[] = await m.query(`${SELECT_EVENTS} ${where}`, params);
      return rows.map((row) => this.toDto(row, access));
    });
  }

  /**
   * The club's past events, latest first, a page at a time: `before` is the
   * `next` of the page before (keyset on start, then id). Past never stops
   * growing, so it's the one list that's paged.
   */
  pastPage(access: ClubAccess, query: { before?: string; limit?: number }): Promise<PastEventsPageDto> {
    const limit = query.limit ?? 20;
    const cursor = query.before ? decodeEventCursor(query.before) : null;
    if (query.before && !cursor) throw HttpError.badRequest('A wrong page cursor', 'INVALID_CURSOR');
    const past = `e.status IN ('published', 'cancelled') AND e.ends_at <= now()`;
    return this.inClub(access, async (m) => {
      const rows: EventRow[] = await m.query(
        `${SELECT_EVENTS} AND ${past}
           AND ($3::timestamptz IS NULL OR (e.starts_at, e.id) < ($3, $4::uuid))
         ORDER BY e.starts_at DESC, e.id DESC
         LIMIT $5`,
        [access.clubId, access.userId, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
      );
      const [{ total }]: { total: number }[] = await m.query(
        `SELECT count(*)::int AS total FROM events e WHERE e.club_id = $1 AND ${past}`,
        [access.clubId],
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        events: page.map((row) => this.toDto(row, access)),
        next: rows.length > limit ? encodeEventCursor(last.starts_at, last.id) : null,
        total,
      };
    });
  }

  /**
   * Creates a draft, or publishes it straight away when asked and allowed.
   * With `repeat`, creates the whole series at once (each at the same local
   * time in the workspace's zone) and returns the first.
   */
  create(access: ClubAccess, dto: CreateEventDto): Promise<EventDto> {
    if (dto.publish && !access.has(Permission.EventPublish)) {
      throw missingPermission([Permission.EventPublish]);
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    assertEndsAfterStart(startsAt, endsAt);

    return this.inClub(access, async (m, orgId) => {
      const types = checkTicketTypes(wantedTypes(dto) ?? []);
      const currency = await this.payments.currencyFor(m, orgId, types.some((t) => t.priceCents > 0));
      const questions = prepareQuestions(dto.questions ?? []);
      const dates = dto.repeat
        ? occurrences(startsAt, endsAt, dto.repeat.every, dto.repeat.count, await TenantService.timeZone(m))
        : [{ startsAt, endsAt }];
      const seriesId = dto.repeat ? randomUUID() : null;
      const ids: string[] = [];
      for (const date of dates) {
        const [{ id }]: { id: string }[] = await m.query(
          `INSERT INTO events
             (org_id, club_id, created_by, title, description, location,
              starts_at, ends_at, capacity, visibility, status, published_at, series_id, repeat_every,
              currency, refund_cutoff_hours, questions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           RETURNING id`,
          [
            orgId,
            access.clubId,
            access.userId,
            dto.title.trim(),
            dto.description?.trim() || null,
            dto.location?.trim() || null,
            date.startsAt,
            date.endsAt,
            dto.capacity ?? null,
            dto.visibility ?? EventVisibility.Members,
            dto.publish ? EventStatus.Published : EventStatus.Draft,
            dto.publish ? new Date() : null,
            seriesId,
            dto.repeat?.every ?? null,
            currency,
            dto.refundCutoffHours ?? 48,
            JSON.stringify(questions),
          ],
        );
        // each occurrence sells its own tickets
        await saveTicketTypes(m, orgId, id, types);
        ids.push(id);
      }
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventCreated,
        clubId: access.clubId,
        eventId: ids[0],
        details: { title: dto.title.trim(), published: !!dto.publish, ...(dto.repeat && { repeat: dto.repeat }) },
      });
      return this.findOne(m, access, ids[0]);
    });
  }

  /**
   * Edits an event you may manage. Fields left out keep their value. The
   * capacity can't drop below the people already registered. A new time or
   * place on a published event is emailed to everyone registered. With
   * `following`, the later events of its series change too (cancelled ones
   * stay as they are): the same fields, and a new time moved the same way on
   * the clock, each keeping its own date.
   */
  async update(access: ClubAccess, eventId: string, dto: UpdateEventDto, scope: SeriesScope = 'this'): Promise<EventDto> {
    const { event, changes, orgId, club } = await this.inClub(access, async (m, orgId) => {
      // locked, so a registration can't slip in between the capacity check and the update
      const [event, ...later] = await this.lockSeries(m, access, eventId, scope);
      if (event.status === EventStatus.Cancelled) {
        throw HttpError.conflict("A cancelled event can't be changed", 'EVENT_CANCELLED');
      }
      const edited = {
        startsAt: dto.startsAt ? new Date(dto.startsAt) : event.starts_at,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : event.ends_at,
      };
      assertEndsAfterStart(edited.startsAt, edited.endsAt);
      const club = await this.clubDetails(m, access.clubId);
      const asked = wantedTypes(dto);
      const types = asked === undefined ? undefined : checkTicketTypes(asked);
      const tickets =
        types === undefined
          ? undefined
          : { types, currency: await this.payments.currencyFor(m, orgId, types.some((t) => t.priceCents > 0)), orgId };

      const changes = [await this.applyUpdate(m, event, dto, edited, club, tickets)];
      const moving = dto.startsAt !== undefined || dto.endsAt !== undefined;
      for (const other of later) {
        if (other.status === EventStatus.Cancelled) continue;
        const own = { startsAt: other.starts_at, endsAt: other.ends_at };
        const times = moving
          ? shiftLike(own, { before: { startsAt: event.starts_at, endsAt: event.ends_at }, after: edited }, club.timeZone)
          : own;
        changes.push(await this.applyUpdate(m, other, dto, times, club, tickets));
      }
      // opening or closing registration reads as its own thing; anything else is an edit
      const fields = Object.keys(dto).filter((key) => dto[key as keyof UpdateEventDto] !== undefined);
      const toggle = fields.length === 1 && fields[0] === 'registrationOpen';
      await audit(m, {
        actorId: access.userId,
        action: toggle
          ? dto.registrationOpen
            ? AuditAction.EventRegistrationOpened
            : AuditAction.EventRegistrationClosed
          : AuditAction.EventUpdated,
        clubId: access.clubId,
        eventId,
        details: {
          title: dto.title?.trim() ?? event.title,
          ...(!toggle && { fields }),
          ...(changes.length > 1 && { alsoLater: changes.length - 1 }),
        },
      });
      return { event: await this.findOne(m, access, eventId), changes, orgId, club };
    });

    let result = event;
    for (const change of changes) {
      if (!change.morePlaces) continue;
      await this.waitlist.promote(orgId, change.eventId);
      // places were just handed out: the counts have moved
      if (change.eventId === eventId) result = await this.inClub(access, (m) => this.findOne(m, access, eventId));
    }
    for (const { eventId: id, notify } of changes) {
      if (!notify || notify.recipients.length === 0) continue;
      this.email.inBackground(
        'event changed',
        this.email.sendEventChanged(notify.recipients, {
          eventTitle: notify.title,
          clubName: club.name,
          orgSlug: club.orgSlug,
          clubId: access.clubId,
          eventId: id,
          when: notify.when,
          where: notify.where,
          before: notify.before,
        }),
      );
    }
    return result;
  }

  // one event's share of an edit, with the event locked
  private async applyUpdate(
    m: EntityManager,
    event: EventRow,
    dto: UpdateEventDto,
    { startsAt, endsAt }: { startsAt: Date; endsAt: Date },
    club: ClubDetails,
    // new ticket types (and their currency), or undefined to keep them
    tickets?: { types: ReturnType<typeof checkTicketTypes>; currency: string | null; orgId: string },
  ): Promise<EventChange> {
    const capacity = dto.capacity === undefined ? event.capacity : dto.capacity;
    if (capacity !== null) {
      const [{ count }]: { count: number }[] = await m.query(
        `SELECT count(*)::int AS count FROM registrations WHERE event_id = $1 AND cancelled_at IS NULL`,
        [event.id],
      );
      if (capacity < count) {
        throw HttpError.conflict(
          `${count} people are already registered; the capacity can't be lower`,
          'CAPACITY_BELOW_REGISTERED',
          { registered: count },
        );
      }
    }

    const title = dto.title?.trim() ?? event.title;
    const location = dto.location === undefined ? event.location : dto.location.trim() || null;
    // closing keeps the first close time; opening clears it
    const closedAt =
      dto.registrationOpen === undefined
        ? event.registration_closed_at
        : dto.registrationOpen
          ? null
          : (event.registration_closed_at ?? new Date());

    await m.query(
      `UPDATE events SET
         title = $2, description = $3, location = $4,
         starts_at = $5, ends_at = $6, capacity = $7, visibility = $8, registration_closed_at = $9,
         currency = $10, refund_cutoff_hours = $11, questions = $12
       WHERE id = $1`,
      [
        event.id,
        title,
        dto.description === undefined ? event.description : dto.description.trim() || null,
        location,
        startsAt,
        endsAt,
        capacity,
        dto.visibility ?? event.visibility,
        closedAt,
        tickets ? (tickets.currency ?? event.currency) : event.currency,
        dto.refundCutoffHours ?? event.refund_cutoff_hours,
        // each event keeps its own ids for questions it already asked
        JSON.stringify(dto.questions === undefined ? event.questions : prepareQuestions(dto.questions, event.questions)),
      ],
    );

    if (tickets) {
      // another event of a series has its own ids: its types are matched by name
      const own = await ticketTypes(m, event.id);
      const ownIds = new Set(own.map((t) => t.id));
      const byName = new Map(own.map((t) => [t.name.toLowerCase(), t.id]));
      const types = tickets.types.map((t) => {
        const id = t.id && ownIds.has(t.id) ? t.id : byName.get(t.name.toLowerCase());
        return { ...t, id };
      });
      await saveTicketTypes(m, tickets.orgId, event.id, types);
    }

    // drafts have nobody registered; a published event tells its people
    const moved = startsAt.getTime() !== event.starts_at.getTime() || endsAt.getTime() !== event.ends_at.getTime();
    const relocated = location !== event.location;
    const notify =
      event.status === EventStatus.Published && (moved || relocated)
        ? {
            recipients: await this.recipients(m, event.id),
            title,
            when: formatWhen(startsAt, endsAt, club.timeZone),
            where: location,
            before: {
              ...(moved && { when: formatWhen(event.starts_at, event.ends_at, club.timeZone) }),
              ...(relocated && { where: event.location }),
            },
          }
        : null;
    // more room (a higher or no limit, or registration open again): the waitlist goes first
    const morePlaces =
      (event.capacity !== null && (capacity === null || capacity > event.capacity)) ||
      (event.registration_closed_at !== null && closedAt === null);
    return { eventId: event.id, notify, morePlaces };
  }

  /**
   * Calls off a published event: it stays listed as cancelled, tickets stop
   * working at the door, and everyone registered is emailed (with the note,
   * if there is one). Drafts are deleted instead; ended events are history.
   * With `following`, the later published events of its series go too.
   */
  async cancel(
    access: ClubAccess,
    eventId: string,
    { reason }: CancelEventDto,
    scope: SeriesScope = 'this',
  ): Promise<EventDto> {
    const note = reason?.trim() || null;
    const { event, cancelled, club, orgId } = await this.inClub(access, async (m, orgId) => {
      const [event, ...later] = await this.lockSeries(m, access, eventId, scope);
      if (event.status === EventStatus.Draft) {
        throw HttpError.conflict('A draft is deleted, not cancelled', 'EVENT_IS_DRAFT');
      }
      if (event.status === EventStatus.Cancelled) {
        throw HttpError.conflict('This event is already cancelled', 'EVENT_ALREADY_CANCELLED');
      }
      if (event.ends_at <= new Date()) {
        throw HttpError.conflict('This event has ended', 'EVENT_ENDED');
      }
      const club = await this.clubDetails(m, access.clubId);
      const targets = [event, ...later.filter((e) => e.status === EventStatus.Published && e.ends_at > new Date())];
      const cancelled = [];
      for (const target of targets) {
        await m.query(
          `UPDATE events SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1`,
          [target.id, note],
        );
        cancelled.push({
          eventId: target.id,
          title: target.title,
          when: formatWhen(target.starts_at, target.ends_at, club.timeZone),
          recipients: [...(await this.recipients(m, target.id)), ...(await this.waiting(m, target.id))],
        });
      }
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventCancelled,
        clubId: access.clubId,
        eventId,
        details: {
          title: event.title,
          reason: note,
          told: cancelled.reduce((sum, c) => sum + c.recipients.length, 0),
          ...(cancelled.length > 1 && { alsoLater: cancelled.length - 1 }),
        },
      });
      return { event: await this.findOne(m, access, eventId), cancelled, club, orgId };
    });
    // everyone who paid gets their money back
    for (const { eventId: id } of cancelled) {
      this.email.inBackground('refunds', this.payments.refundEvent(orgId, id));
    }

    for (const { eventId: id, title, when, recipients } of cancelled) {
      if (recipients.length === 0) continue;
      this.email.inBackground(
        'event cancelled',
        this.email.sendEventCancelled(recipients, {
          eventTitle: title,
          clubName: club.name,
          orgSlug: club.orgSlug,
          clubId: access.clubId,
          eventId: id,
          when,
          reason: note,
        }),
      );
    }
    return event;
  }

  /**
   * Deletes a draft you may manage (with `following`, the later drafts of its
   * series too). A published event is cancelled instead, so its history stays.
   */
  remove(access: ClubAccess, eventId: string, scope: SeriesScope = 'this'): Promise<void> {
    return this.inClub(access, async (m) => {
      const [event, ...later] = await this.lockSeries(m, access, eventId, scope);
      if (event.status !== EventStatus.Draft) {
        throw HttpError.conflict('Only drafts can be deleted; cancel a published event', 'EVENT_NOT_DRAFT');
      }
      const ids = [event, ...later.filter((e) => e.status === EventStatus.Draft)].map((e) => e.id);
      await m.query(`DELETE FROM events WHERE id = ANY($1::uuid[])`, [ids]);
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventDeleted,
        clubId: access.clubId,
        details: { title: event.title, ...(ids.length > 1 && { alsoLater: ids.length - 1 }) },
      });
    });
  }

  /**
   * Publishes a draft you may manage (with `following`, the later drafts of
   * its series too): visible and open for registration.
   */
  publish(access: ClubAccess, eventId: string, scope: SeriesScope = 'this'): Promise<EventDto> {
    return this.inClub(access, async (m) => {
      const [event, ...later] = await this.lockSeries(m, access, eventId, scope);
      if (event.status !== EventStatus.Draft) {
        throw HttpError.conflict('Only drafts can be published', 'EVENT_NOT_DRAFT');
      }
      const ids = [event, ...later.filter((e) => e.status === EventStatus.Draft)].map((e) => e.id);
      await m.query(`UPDATE events SET status = 'published', published_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventPublished,
        clubId: access.clubId,
        eventId,
        details: { title: event.title, ...(ids.length > 1 && { alsoLater: ids.length - 1 }) },
      });
      return this.findOne(m, access, eventId);
    });
  }

  /**
   * Emails everyone going to an event (and the waitlist, if asked), from
   * someone who can edit it. Kept, for the record. Ten a day per event at
   * most: enough for real news, not enough to spam.
   */
  async message(access: ClubAccess, eventId: string, dto: SendEventMessageDto): Promise<EventMessageDto> {
    const subject = dto.subject.trim();
    const body = dto.body.trim();
    if (!subject || !body) throw HttpError.badRequest('Write a subject and a message', 'MESSAGE_EMPTY');
    const { sent, recipients, club, event } = await this.inClub(access, async (m, orgId) => {
      const event = await this.lockForManage(m, access, eventId);
      if (event.status === EventStatus.Draft) {
        throw HttpError.conflict('Publish the event first: nobody is going to a draft', 'EVENT_IS_DRAFT');
      }
      const [{ today }]: { today: number }[] = await m.query(
        `SELECT count(*)::int AS today FROM event_messages WHERE event_id = $1 AND created_at > now() - interval '1 day'`,
        [eventId],
      );
      if (today >= MESSAGES_PER_DAY) {
        throw HttpError.conflict(`${MESSAGES_PER_DAY} messages a day per event at most`, 'TOO_MANY_MESSAGES');
      }
      const recipients: (EventRecipient & { guest: boolean; waiting: boolean })[] = await m.query(
        `SELECT r.id AS "registrationId", u.email AS "to", u.name, (u.password_hash IS NULL) AS guest, false AS waiting
         FROM registrations r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = $1 AND r.cancelled_at IS NULL
         UNION ALL
         SELECT w.id, u.email, u.name, (u.password_hash IS NULL), true
         FROM waitlist_entries w JOIN users u ON u.id = w.user_id
         WHERE w.event_id = $1 AND w.promoted_at IS NULL AND $2`,
        [eventId, !!dto.toWaitlist],
      );
      if (recipients.length === 0) throw HttpError.conflict('Nobody is going yet', 'NO_RECIPIENTS');
      const [sent]: { id: string; created_at: Date }[] = await m.query(
        `INSERT INTO event_messages (org_id, event_id, sender_id, subject, body, to_waitlist, recipient_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
        [orgId, eventId, access.userId, subject, body, !!dto.toWaitlist, recipients.length],
      );
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventMessaged,
        clubId: access.clubId,
        eventId,
        details: { title: event.title, subject, people: recipients.length },
      });
      return { sent, recipients, club: await this.clubDetails(m, access.clubId), event };
    });

    const [{ name: senderName }]: { name: string }[] = await this.inClub(access, (m) =>
      m.query(`SELECT name FROM users WHERE id = $1`, [access.userId]),
    );
    this.email.inBackground(
      'event message',
      this.email.sendEventMessage(recipients, {
        messageId: sent.id,
        senderName,
        clubName: club.name,
        eventTitle: event.title,
        when: formatWhen(event.starts_at, event.ends_at, club.timeZone),
        subject,
        body,
        orgSlug: club.orgSlug,
        clubId: access.clubId,
        eventId,
      }),
    );
    return {
      id: sent.id,
      subject,
      body,
      senderName,
      toWaitlist: !!dto.toWaitlist,
      recipientCount: recipients.length,
      sentAt: sent.created_at,
    };
  }

  // --- cover image (people who can edit the event) ---------------------------------------

  /**
   * Sets the event's cover image: a JPEG, PNG or WebP (told by its bytes,
   * not its name) of 2 MB at most; the browser resizes it first. Kept under
   * a new random name each time, so caches never show an old one; the old
   * file goes once the new one is in place.
   */
  async setCover(access: ClubAccess, eventId: string, data: unknown): Promise<EventDto> {
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw HttpError.badRequest('Send the image itself, as image/webp, image/jpeg or image/png', 'IMAGE_REQUIRED');
    }
    if (data.length > MAX_COVER_BYTES) throw HttpError.badRequest('Images can be 2 MB at most', 'IMAGE_TOO_LARGE');
    const kind = imageKind(data);
    if (!kind) throw HttpError.badRequest('That isn\'t a JPEG, PNG or WebP image', 'IMAGE_NOT_SUPPORTED');
    const key = `covers/${randomUUID()}.${kind}`;
    await this.files.put(key, data);
    try {
      const { event, old } = await this.inClub(access, async (m) => {
        const event = await this.lockForManage(m, access, eventId);
        await m.query(`UPDATE events SET cover_image_key = $2 WHERE id = $1`, [eventId, key]);
        return { event: await this.findOne(m, access, eventId), old: event.cover_image_key };
      });
      if (old) await this.files.delete(old);
      return event;
    } catch (error) {
      // not allowed, or no such event: the file goes again
      await this.files.delete(key);
      throw error;
    }
  }

  /** Takes the cover image off. */
  async removeCover(access: ClubAccess, eventId: string): Promise<EventDto> {
    const { event, old } = await this.inClub(access, async (m) => {
      const event = await this.lockForManage(m, access, eventId);
      await m.query(`UPDATE events SET cover_image_key = NULL WHERE id = $1`, [eventId]);
      return { event: await this.findOne(m, access, eventId), old: event.cover_image_key };
    });
    if (old) await this.files.delete(old);
    return event;
  }

  // --- discount codes (people who can edit the event) ------------------------------------

  /** An event's discount codes, with how many times each has been used. */
  discountCodes(access: ClubAccess, eventId: string): Promise<DiscountCodeDto[]> {
    return this.inClub(access, async (m) => {
      await this.lockForManage(m, access, eventId);
      return this.codeList(m, eventId);
    });
  }

  /** A new code: a percentage or an amount off the event's paid tickets. */
  createDiscountCode(access: ClubAccess, eventId: string, dto: CreateDiscountCodeDto): Promise<DiscountCodeDto[]> {
    if ((dto.percentOff === undefined) === (dto.amountOffCents === undefined)) {
      throw HttpError.badRequest('Give a percentage off or an amount off, not both', 'CODE_NEEDS_ONE_DISCOUNT');
    }
    return this.inClub(access, async (m, orgId) => {
      const event = await this.lockForManage(m, access, eventId);
      try {
        await m.query(
          `INSERT INTO discount_codes (org_id, event_id, code, percent_off, amount_off_cents, max_uses, expires_at, created_by)
           VALUES ($1, $2, upper($3), $4, $5, $6, $7, $8)`,
          [orgId, eventId, dto.code, dto.percentOff ?? null, dto.amountOffCents ?? null, dto.maxUses ?? null, dto.expiresAt ?? null, access.userId],
        );
      } catch (error) {
        if (isUniqueViolation(error, 'discount_codes_event_id_code_key')) {
          throw HttpError.conflict('This event already has that code', 'CODE_TAKEN');
        }
        throw error;
      }
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventCodeCreated,
        clubId: access.clubId,
        eventId,
        details: { title: event.title, code: dto.code.toUpperCase() },
      });
      return this.codeList(m, eventId);
    });
  }

  /** Turns a code on or off; the tickets bought with it stay as they are. */
  setDiscountCodeActive(access: ClubAccess, eventId: string, codeId: string, active: boolean): Promise<DiscountCodeDto[]> {
    return this.inClub(access, async (m) => {
      await this.lockForManage(m, access, eventId);
      const [rows]: [unknown[], number] = await m.query(
        `UPDATE discount_codes SET active = $3 WHERE id = $1 AND event_id = $2 RETURNING id`,
        [codeId, eventId, active],
      );
      if (rows.length === 0) throw HttpError.notFound('No such code', 'CODE_NOT_FOUND');
      return this.codeList(m, eventId);
    });
  }

  private async codeList(m: EntityManager, eventId: string): Promise<DiscountCodeDto[]> {
    const rows: {
      id: string;
      code: string;
      percent_off: number | null;
      amount_off_cents: number | null;
      max_uses: number | null;
      expires_at: Date | null;
      active: boolean;
      uses: number;
    }[] = await m.query(
      `SELECT d.id, d.code, d.percent_off, d.amount_off_cents, d.max_uses, d.expires_at, d.active,
              ((SELECT count(*) FROM registrations r WHERE r.discount_code_id = d.id AND r.cancelled_at IS NULL)
             + (SELECT count(*) FROM checkouts c
                WHERE c.discount_code_id = d.id AND c.status = 'pending' AND c.expires_at > now()))::int AS uses
       FROM discount_codes d WHERE d.event_id = $1 ORDER BY d.created_at`,
      [eventId],
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      percentOff: r.percent_off,
      amountOffCents: r.amount_off_cents,
      maxUses: r.max_uses,
      uses: r.uses,
      expiresAt: r.expires_at,
      active: r.active,
    }));
  }

  /** What's been sent about an event, newest first (people who can edit it). */
  messages(access: ClubAccess, eventId: string): Promise<EventMessageDto[]> {
    return this.inClub(access, async (m) => {
      await this.lockForManage(m, access, eventId);
      const rows: { id: string; subject: string; body: string; sender_name: string | null; to_waitlist: boolean; recipient_count: number; created_at: Date }[] =
        await m.query(
          `SELECT em.id, em.subject, em.body, u.name AS sender_name, em.to_waitlist, em.recipient_count, em.created_at
           FROM event_messages em LEFT JOIN users u ON u.id = em.sender_id
           WHERE em.event_id = $1 ORDER BY em.created_at DESC`,
          [eventId],
        );
      return rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        body: r.body,
        senderName: r.sender_name ?? 'A deleted account',
        toWaitlist: r.to_waitlist,
        recipientCount: r.recipient_count,
        sentAt: r.created_at,
      }));
    });
  }

  /** Everyone with an active registration, in the order they registered. */
  attendees(access: ClubAccess, eventId: string): Promise<EventAttendeeDto[]> {
    return this.inClub(access, async (m) => {
      await this.findOne(m, access, eventId); // 404 if it isn't this club's
      // users is global (no RLS); registrations limits the join to this event
      const rows: { user_id: string; name: string; created_at: Date; checked_in_at: Date | null; answers: Record<string, string> }[] =
        await m.query(
          `SELECT r.user_id, u.name, r.created_at, r.checked_in_at, r.answers
           FROM registrations r
           JOIN users u ON u.id = r.user_id
           WHERE r.event_id = $1 AND r.cancelled_at IS NULL
           ORDER BY r.created_at`,
          [eventId],
        );
      return rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        registeredAt: r.created_at,
        checkedInAt: r.checked_in_at,
        answers: r.answers ?? {},
      }));
    });
  }

  /** The event as a calendar file, for "Add to calendar". Any member who can see it. */
  calendar(access: ClubAccess, eventId: string): Promise<{ filename: string; ics: string }> {
    return this.inClub(access, async (m) => {
      const event = await this.findOne(m, access, eventId);
      const club = await this.clubDetails(m, access.clubId);
      const url = new URL(`/o/${club.orgSlug}`, config.appUrl);
      url.searchParams.set('club', access.clubId);
      url.searchParams.set('event', eventId);
      return {
        filename: `${fileSlug(event.title)}.ics`,
        ics: buildIcs({
          eventId,
          title: event.title,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          location: event.location,
          description: `${club.name}. ${url.toString()}`,
          url: url.toString(),
          cancelled: event.status === EventStatus.Cancelled,
        }),
      };
    });
  }

  /**
   * The attendee list as a spreadsheet: what the app shows organisers (names,
   * when they registered and came in, whether they're from outside the
   * workspace), plus the waitlist in order. No email addresses: the app only
   * shows those to workspace staff. Times are in the workspace's zone.
   */
  attendeesCsv(access: ClubAccess, eventId: string): Promise<{ filename: string; csv: string }> {
    return this.inClub(access, async (m) => {
      const event = await this.findOne(m, access, eventId); // 404 if it isn't this club's
      const zone = await TenantService.timeZone(m);
      const stamp = (at: Date | null) => (at ? wallClock(at, zone) : '');

      const going: {
        name: string;
        created_at: Date;
        checked_in_at: Date | null;
        outsider: boolean;
        answers: Record<string, string>;
        ticket: string | null;
        paid_cents: number | null;
        refunded: boolean;
        code: string | null;
      }[] = await m.query(
        `SELECT u.name, r.created_at, r.checked_in_at, r.answers,
                (SELECT t.name FROM ticket_types t WHERE t.id = r.ticket_type_id) AS ticket,
                r.amount_paid_cents AS paid_cents, (r.refunded_at IS NOT NULL) AS refunded,
                (SELECT d.code FROM discount_codes d WHERE d.id = r.discount_code_id) AS code,
                NOT EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = r.org_id AND om.user_id = r.user_id) AS outsider
         FROM registrations r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = $1 AND r.cancelled_at IS NULL
         ORDER BY lower(u.name)`,
        [eventId],
      );
      const waiting: { name: string; created_at: Date; outsider: boolean; answers: Record<string, string>; ticket: string | null }[] = await m.query(
        `SELECT u.name, w.created_at, w.answers,
                (SELECT t.name FROM ticket_types t WHERE t.id = w.ticket_type_id) AS ticket,
                NOT EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = w.org_id AND om.user_id = w.user_id) AS outsider
         FROM waitlist_entries w JOIN users u ON u.id = w.user_id
         WHERE w.event_id = $1 AND w.promoted_at IS NULL
         ORDER BY w.created_at, w.id`,
        [eventId],
      );

      // a column per question the event asks, after the rest
      const questions = event.questions;
      const answersOf = (answers: Record<string, string> | null) => questions.map((q) => answers?.[q.id] ?? '');
      // with ticket types, which one each person has; with paid ones, what they paid and any code
      const typed = event.ticketTypes.length > 0;
      const paid = event.ticketTypes.some((t) => t.priceCents > 0);
      const money = (cents: number | null, refunded: boolean) =>
        cents === null ? '' : `${(cents / 100).toFixed(2)} ${event.price?.currency.toUpperCase() ?? ''}${refunded ? ' (refunded)' : ''}`.trim();
      const csv = toCsv([
        [
          'Name',
          'Status',
          `Registered (${zone})`,
          `Checked in (${zone})`,
          'From outside the workspace',
          ...(typed ? ['Ticket'] : []),
          ...(paid ? ['Paid', 'Code'] : []),
          ...questions.map((q) => q.label),
        ],
        ...going.map((p) => [
          p.name,
          p.checked_in_at ? 'Checked in' : 'Going',
          stamp(p.created_at),
          stamp(p.checked_in_at),
          p.outsider ? 'Yes' : 'No',
          ...(typed ? [p.ticket ?? ''] : []),
          ...(paid ? [money(p.paid_cents, p.refunded), p.code ?? ''] : []),
          ...answersOf(p.answers),
        ]),
        ...waiting.map((p, i) => [
          p.name,
          `Waitlist ${i + 1}`,
          stamp(p.created_at),
          '',
          p.outsider ? 'Yes' : 'No',
          ...(typed ? [p.ticket ?? ''] : []),
          ...(paid ? ['', ''] : []),
          ...answersOf(p.answers),
        ]),
      ]);
      // a list of people left the app: worth knowing who took it
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventAttendeesExported,
        clubId: access.clubId,
        eventId,
        details: { title: event.title, people: going.length + waiting.length },
      });
      return { filename: `${fileSlug(event.title)}-attendees.csv`, csv };
    });
  }

  /** One event of this club, as the current user sees it; drafts only if they may manage them. */
  async findOne(m: EntityManager, access: ClubAccess, eventId: string): Promise<EventDto> {
    const rows: EventRow[] = await m.query(`${SELECT_EVENTS} AND e.id = $3`, [
      access.clubId,
      access.userId,
      eventId,
    ]);
    const row = rows[0];
    if (!row || (row.status === EventStatus.Draft && !canManage(access, row.created_by))) {
      throw eventNotFound();
    }
    return this.toDto(row, access);
  }

  /** Runs `work` in the club's workspace (RLS), passing its org id along. */
  async inClub<T>(access: ClubAccess, work: (m: EntityManager, orgId: string) => Promise<T>): Promise<T> {
    const orgId = await this.tenant.orgIdForClub(access.clubId);
    if (!orgId) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
    return this.tenant.withTenant(orgId, (m) => work(m, orgId));
  }

  // everyone holding an active registration, with where to email them
  // (users is global, no RLS; registrations limits the join to this event)
  private async recipients(m: EntityManager, eventId: string): Promise<EventRecipient[]> {
    const rows: { id: string; email: string; name: string }[] = await m.query(
      `SELECT r.id, u.email, u.name
       FROM registrations r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = $1 AND r.cancelled_at IS NULL
       ORDER BY r.created_at`,
      [eventId],
    );
    return rows.map((r) => ({ registrationId: r.id, to: r.email, name: r.name }));
  }

  // the people on the waitlist (their entry id keys the email, as a registration's would)
  private async waiting(m: EntityManager, eventId: string): Promise<EventRecipient[]> {
    const rows: { id: string; email: string; name: string }[] = await m.query(
      `SELECT w.id, u.email, u.name FROM waitlist_entries w JOIN users u ON u.id = w.user_id
       WHERE w.event_id = $1 AND w.promoted_at IS NULL ORDER BY w.created_at`,
      [eventId],
    );
    return rows.map((r) => ({ registrationId: r.id, to: r.email, name: r.name }));
  }

  private async clubDetails(m: EntityManager, clubId: string): Promise<ClubDetails> {
    const [row]: { name: string; slug: string; time_zone: string }[] = await m.query(
      `SELECT c.name, o.slug, o.time_zone FROM clubs c JOIN organisations o ON o.id = c.org_id WHERE c.id = $1`,
      [clubId],
    );
    return { name: row.name, orgSlug: row.slug, timeZone: row.time_zone };
  }

  // Locks the event row for the rest of the transaction and checks the caller
  // may manage it. Someone who can't see a draft gets 404, not 403.
  private async lockForManage(m: EntityManager, access: ClubAccess, eventId: string): Promise<EventRow> {
    const rows: EventRow[] = await m.query(
      `SELECT * FROM events WHERE id = $1 AND club_id = $2 FOR UPDATE`,
      [eventId, access.clubId],
    );
    const event = rows[0];
    if (!event) throw eventNotFound();
    if (!canManage(access, event.created_by)) {
      if (event.status === EventStatus.Draft) throw eventNotFound();
      throw missingPermission([Permission.EventManageAny]);
    }
    return event;
  }

  // The event, locked as above, and for "this and following" the later events
  // of its series (the ones this person may manage), also locked, by date.
  private async lockSeries(
    m: EntityManager,
    access: ClubAccess,
    eventId: string,
    scope: SeriesScope,
  ): Promise<[EventRow, ...EventRow[]]> {
    const event = await this.lockForManage(m, access, eventId);
    if (scope !== 'following' || !event.series_id) return [event];
    const later: EventRow[] = await m.query(
      `SELECT * FROM events
       WHERE series_id = $1 AND club_id = $2 AND (starts_at, id) > ($3, $4)
       ORDER BY starts_at, id FOR UPDATE`,
      [event.series_id, access.clubId, event.starts_at, event.id],
    );
    return [event, ...later.filter((e) => canManage(access, e.created_by))];
  }

  private toDto(row: EventRow, access: ClubAccess): EventDto {
    return {
      id: row.id,
      clubId: row.club_id,
      title: row.title,
      description: row.description,
      location: row.location,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      capacity: row.capacity,
      visibility: row.visibility,
      status: row.status,
      registrationOpen: row.registration_closed_at === null,
      cancelledAt: row.cancelled_at,
      cancelReason: row.cancel_reason,
      registeredCount: row.registered_count ?? 0,
      attendedCount: row.attended_count ?? 0,
      youreGoing: row.youre_going ?? false,
      waitlistCount: row.waitlist_count ?? 0,
      yourWaitlistPosition: row.waitlist_position ?? null,
      canManage: canManage(access, row.created_by),
      series: row.series_id
        ? { id: row.series_id, every: row.repeat_every!, index: row.series_index, count: row.series_count }
        : null,
      ...ticketsOf(row),
      refundCutoffHours: row.refund_cutoff_hours ?? 48,
      heldCount: row.held_count ?? 0,
      yourPayment:
        row.your_paid_cents !== null && row.your_paid_cents !== undefined && row.your_paid_currency
          ? {
              amountCents: row.your_paid_cents,
              currency: row.your_paid_currency,
              refundable: Date.now() < row.starts_at.getTime() - (row.refund_cutoff_hours ?? 48) * 3_600_000,
            }
          : null,
      salesCents:
        canManage(access, row.created_by) && (row.ticket_types ?? []).some((t) => t.price_cents > 0) ? (row.sales_cents ?? 0) : null,
      questions: row.questions ?? [],
      coverUrl: row.cover_image_key ? `/files/${row.cover_image_key}` : null,
    };
  }
}

// "2026-10-24 18:30" on the clock in `zone`: sorts as text, and spreadsheets read it as a date
function wallClock(at: Date, zone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function assertEndsAfterStart(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) {
    throw HttpError.badRequest('The event must end after it starts', 'EVENT_ENDS_BEFORE_START');
  }
}

// What the request says the ticket types should be: the list, the one-price
// shorthand ("General admission"; null: free), or undefined to leave them.
function wantedTypes(dto: CreateEventDto | UpdateEventDto) {
  if (dto.ticketTypes !== undefined) return dto.ticketTypes;
  if (dto.priceCents === undefined) return undefined;
  return dto.priceCents === null ? [] : [{ name: 'General admission', priceCents: dto.priceCents }];
}

// An event's ticket types as people see them, the cheapest paid one ("from"), and theirs.
function ticketsOf(row: EventRow): Pick<EventDto, 'ticketTypes' | 'price' | 'yourTicketType'> {
  const now = Date.now();
  const types = (row.ticket_types ?? []).map((t) => {
    const remaining = t.capacity === null ? null : Math.max(0, t.capacity - t.taken);
    const salesEndAt = t.sales_end_at ? new Date(t.sales_end_at) : null;
    return {
      id: t.id,
      name: t.name,
      priceCents: t.price_cents,
      currency: t.price_cents > 0 ? row.currency : null,
      capacity: t.capacity,
      remaining,
      membersOnly: t.members_only,
      salesEndAt,
      onSale: (salesEndAt === null || salesEndAt.getTime() > now) && remaining !== 0,
    };
  });
  const paid = types.filter((t) => t.priceCents > 0);
  const cheapest = paid.reduce<(typeof paid)[number] | null>((a, t) => (!a || t.priceCents < a.priceCents ? t : a), null);
  return {
    ticketTypes: types,
    price: cheapest && row.currency ? { amountCents: cheapest.priceCents, currency: row.currency } : null,
    yourTicketType: row.your_ticket_type ?? null,
  };
}
