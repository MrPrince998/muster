import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { fileSlug, toCsv } from '../../common/utils/csv.js';
import { buildIcs } from '../../common/utils/ics.js';
import { prepareQuestions, type Question } from './questions.js';
import { occurrences, shiftLike } from '../../common/utils/recurrence.js';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';
import { EmailService, type EventRecipient } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import type { ClubAccess } from '../permission/club-access.js';
import { WaitlistService } from '../waitlist/waitlist.service.js';
import { PaymentService } from '../payment/payment.service.js';
import { Permission } from '../permission/permissions.js';
import type {
  CancelEventDto,
  CreateEventDto,
  EventAttendeeDto,
  EventDto,
  EventMessageDto,
  SendEventMessageDto,
  EventScope,
  SeriesScope,
  UpdateEventDto,
} from './dto/event.dto.js';
import { EventStatus, EventVisibility, type RepeatEvery } from './entities/event.entity.js';
import { audit, AuditAction } from '../audit/audit.js';

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
  price_cents: number | null;
  currency: string | null;
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
    e.price_cents, e.currency, e.refund_cutoff_hours, e.questions,
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
          where = `AND e.status IN ('published', 'cancelled') AND e.ends_at <= now() ORDER BY e.starts_at DESC`;
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
      const price = await this.payments.priceFor(m, orgId, dto.priceCents ?? null);
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
              price_cents, currency, refund_cutoff_hours, questions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
            price.priceCents,
            price.currency,
            dto.refundCutoffHours ?? 48,
            JSON.stringify(questions),
          ],
        );
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
      const price = dto.priceCents === undefined ? undefined : await this.payments.priceFor(m, orgId, dto.priceCents);

      const changes = [await this.applyUpdate(m, event, dto, edited, club, price)];
      const moving = dto.startsAt !== undefined || dto.endsAt !== undefined;
      for (const other of later) {
        if (other.status === EventStatus.Cancelled) continue;
        const own = { startsAt: other.starts_at, endsAt: other.ends_at };
        const times = moving
          ? shiftLike(own, { before: { startsAt: event.starts_at, endsAt: event.ends_at }, after: edited }, club.timeZone)
          : own;
        changes.push(await this.applyUpdate(m, other, dto, times, club, price));
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
    // a new price (and its currency), or undefined to keep it
    price?: { priceCents: number | null; currency: string | null },
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
         price_cents = $10, currency = $11, refund_cutoff_hours = $12, questions = $13
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
        price ? price.priceCents : event.price_cents,
        price ? price.currency : event.currency,
        dto.refundCutoffHours ?? event.refund_cutoff_hours,
        // each event keeps its own ids for questions it already asked
        JSON.stringify(dto.questions === undefined ? event.questions : prepareQuestions(dto.questions, event.questions)),
      ],
    );

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

      const going: { name: string; created_at: Date; checked_in_at: Date | null; outsider: boolean; answers: Record<string, string> }[] = await m.query(
        `SELECT u.name, r.created_at, r.checked_in_at, r.answers,
                NOT EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = r.org_id AND om.user_id = r.user_id) AS outsider
         FROM registrations r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = $1 AND r.cancelled_at IS NULL
         ORDER BY lower(u.name)`,
        [eventId],
      );
      const waiting: { name: string; created_at: Date; outsider: boolean; answers: Record<string, string> }[] = await m.query(
        `SELECT u.name, w.created_at, w.answers,
                NOT EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = w.org_id AND om.user_id = w.user_id) AS outsider
         FROM waitlist_entries w JOIN users u ON u.id = w.user_id
         WHERE w.event_id = $1 AND w.promoted_at IS NULL
         ORDER BY w.created_at, w.id`,
        [eventId],
      );

      // a column per question the event asks, after the rest
      const questions = event.questions;
      const answersOf = (answers: Record<string, string> | null) => questions.map((q) => answers?.[q.id] ?? '');
      const csv = toCsv([
        ['Name', 'Status', `Registered (${zone})`, `Checked in (${zone})`, 'From outside the workspace', ...questions.map((q) => q.label)],
        ...going.map((p) => [
          p.name,
          p.checked_in_at ? 'Checked in' : 'Going',
          stamp(p.created_at),
          stamp(p.checked_in_at),
          p.outsider ? 'Yes' : 'No',
          ...answersOf(p.answers),
        ]),
        ...waiting.map((p, i) => [p.name, `Waitlist ${i + 1}`, stamp(p.created_at), '', p.outsider ? 'Yes' : 'No', ...answersOf(p.answers)]),
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
      price: row.price_cents !== null && row.currency ? { amountCents: row.price_cents, currency: row.currency } : null,
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
      salesCents: canManage(access, row.created_by) && row.price_cents !== null ? (row.sales_cents ?? 0) : null,
      questions: row.questions ?? [],
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
