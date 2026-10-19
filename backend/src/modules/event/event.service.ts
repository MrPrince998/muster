import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { TenantService } from '../../database/tenant.service.js';
import { EmailService, type EventRecipient } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import type { ClubAccess } from '../permission/club-access.js';
import { WaitlistService } from '../waitlist/waitlist.service.js';
import { Permission } from '../permission/permissions.js';
import type {
  CancelEventDto,
  CreateEventDto,
  EventAttendeeDto,
  EventDto,
  EventScope,
  UpdateEventDto,
} from './dto/event.dto.js';
import { EventStatus, EventVisibility } from './entities/event.entity.js';

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
}

// Every event read goes through this, so counts and "am I going" are always
// computed the same way. $1 is the club, $2 the current user.
const SELECT_EVENTS = `
  SELECT
    e.id, e.club_id, e.created_by, e.title, e.description, e.location,
    e.starts_at, e.ends_at, e.capacity, e.visibility, e.status,
    e.registration_closed_at, e.cancelled_at, e.cancel_reason,
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

  /** Creates a draft, or publishes it straight away when asked and allowed. */
  create(access: ClubAccess, dto: CreateEventDto): Promise<EventDto> {
    if (dto.publish && !access.has(Permission.EventPublish)) {
      throw missingPermission([Permission.EventPublish]);
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    assertEndsAfterStart(startsAt, endsAt);

    return this.inClub(access, async (m, orgId) => {
      const [{ id }]: { id: string }[] = await m.query(
        `INSERT INTO events
           (org_id, club_id, created_by, title, description, location,
            starts_at, ends_at, capacity, visibility, status, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          orgId,
          access.clubId,
          access.userId,
          dto.title.trim(),
          dto.description?.trim() || null,
          dto.location?.trim() || null,
          startsAt,
          endsAt,
          dto.capacity ?? null,
          dto.visibility ?? EventVisibility.Members,
          dto.publish ? EventStatus.Published : EventStatus.Draft,
          dto.publish ? new Date() : null,
        ],
      );
      return this.findOne(m, access, id);
    });
  }

  /**
   * Edits an event you may manage. Fields left out keep their value. The
   * capacity can't drop below the people already registered. A new time or
   * place on a published event is emailed to everyone registered.
   */
  async update(access: ClubAccess, eventId: string, dto: UpdateEventDto): Promise<EventDto> {
    const { event, notify, orgId, morePlaces } = await this.inClub(access, async (m, orgId) => {
      // locked, so a registration can't slip in between the capacity check and the update
      const event = await this.lockForManage(m, access, eventId);
      if (event.status === EventStatus.Cancelled) {
        throw HttpError.conflict("A cancelled event can't be changed", 'EVENT_CANCELLED');
      }

      const startsAt = dto.startsAt ? new Date(dto.startsAt) : event.starts_at;
      const endsAt = dto.endsAt ? new Date(dto.endsAt) : event.ends_at;
      assertEndsAfterStart(startsAt, endsAt);

      const capacity = dto.capacity === undefined ? event.capacity : dto.capacity;
      if (capacity !== null) {
        const [{ count }]: { count: number }[] = await m.query(
          `SELECT count(*)::int AS count FROM registrations WHERE event_id = $1 AND cancelled_at IS NULL`,
          [eventId],
        );
        if (capacity < count) {
          throw HttpError.conflict(
            `${count} people are already registered; the capacity can't be lower`,
            'CAPACITY_BELOW_REGISTERED',
            { registered: count },
          );
        }
      }

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
           starts_at = $5, ends_at = $6, capacity = $7, visibility = $8, registration_closed_at = $9
         WHERE id = $1`,
        [
          eventId,
          dto.title?.trim() ?? event.title,
          dto.description === undefined ? event.description : dto.description.trim() || null,
          location,
          startsAt,
          endsAt,
          capacity,
          dto.visibility ?? event.visibility,
          closedAt,
        ],
      );

      // drafts have nobody registered; a published event tells its people
      const moved =
        startsAt.getTime() !== event.starts_at.getTime() || endsAt.getTime() !== event.ends_at.getTime();
      const relocated = location !== event.location;
      const club = event.status === EventStatus.Published && (moved || relocated) ? await this.clubDetails(m, access.clubId) : null;
      const notify = club
        ? {
            recipients: await this.recipients(m, eventId),
            club,
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
      return { event: await this.findOne(m, access, eventId), notify, orgId, morePlaces };
    });
    let result = event;
    if (morePlaces) {
      await this.waitlist.promote(orgId, eventId);
      // places were just handed out: the counts have moved
      result = await this.inClub(access, (m) => this.findOne(m, access, eventId));
    }

    if (notify && notify.recipients.length > 0) {
      this.email.inBackground(
        'event changed',
        this.email.sendEventChanged(notify.recipients, {
          eventTitle: event.title,
          clubName: notify.club.name,
          orgSlug: notify.club.orgSlug,
          clubId: access.clubId,
          eventId,
          when: formatWhen(new Date(event.startsAt), new Date(event.endsAt), notify.club.timeZone),
          where: event.location,
          before: notify.before,
        }),
      );
    }
    return result;
  }

  /**
   * Calls off a published event: it stays listed as cancelled, tickets stop
   * working at the door, and everyone registered is emailed (with the note,
   * if there is one). Drafts are deleted instead; ended events are history.
   */
  async cancel(access: ClubAccess, eventId: string, { reason }: CancelEventDto): Promise<EventDto> {
    const note = reason?.trim() || null;
    const { event, recipients, club, when } = await this.inClub(access, async (m) => {
      const event = await this.lockForManage(m, access, eventId);
      if (event.status === EventStatus.Draft) {
        throw HttpError.conflict('A draft is deleted, not cancelled', 'EVENT_IS_DRAFT');
      }
      if (event.status === EventStatus.Cancelled) {
        throw HttpError.conflict('This event is already cancelled', 'EVENT_ALREADY_CANCELLED');
      }
      if (event.ends_at <= new Date()) {
        throw HttpError.conflict('This event has ended', 'EVENT_ENDED');
      }
      await m.query(
        `UPDATE events SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1`,
        [eventId, note],
      );
      const club = await this.clubDetails(m, access.clubId);
      return {
        event: await this.findOne(m, access, eventId),
        recipients: [...(await this.recipients(m, eventId)), ...(await this.waiting(m, eventId))],
        club,
        when: formatWhen(event.starts_at, event.ends_at, club.timeZone),
      };
    });

    if (recipients.length > 0) {
      this.email.inBackground(
        'event cancelled',
        this.email.sendEventCancelled(recipients, {
          eventTitle: event.title,
          clubName: club.name,
          orgSlug: club.orgSlug,
          clubId: access.clubId,
          eventId,
          when,
          reason: note,
        }),
      );
    }
    return event;
  }

  /** Deletes a draft you may manage. A published event is cancelled instead, so its history stays. */
  remove(access: ClubAccess, eventId: string): Promise<void> {
    return this.inClub(access, async (m) => {
      const event = await this.lockForManage(m, access, eventId);
      if (event.status !== EventStatus.Draft) {
        throw HttpError.conflict('Only drafts can be deleted; cancel a published event', 'EVENT_NOT_DRAFT');
      }
      await m.query(`DELETE FROM events WHERE id = $1`, [eventId]);
    });
  }

  /** Publishes a draft you may manage: it becomes visible and open for registration. */
  publish(access: ClubAccess, eventId: string): Promise<EventDto> {
    return this.inClub(access, async (m) => {
      const event = await this.lockForManage(m, access, eventId);
      if (event.status !== EventStatus.Draft) {
        throw HttpError.conflict('Only drafts can be published', 'EVENT_NOT_DRAFT');
      }
      await m.query(`UPDATE events SET status = 'published', published_at = now() WHERE id = $1`, [eventId]);
      return this.findOne(m, access, eventId);
    });
  }

  /** Everyone with an active registration, in the order they registered. */
  attendees(access: ClubAccess, eventId: string): Promise<EventAttendeeDto[]> {
    return this.inClub(access, async (m) => {
      await this.findOne(m, access, eventId); // 404 if it isn't this club's
      // users is global (no RLS); registrations limits the join to this event
      const rows: { user_id: string; name: string; created_at: Date; checked_in_at: Date | null }[] =
        await m.query(
          `SELECT r.user_id, u.name, r.created_at, r.checked_in_at
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
      }));
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

  private async clubDetails(
    m: EntityManager,
    clubId: string,
  ): Promise<{ name: string; orgSlug: string; timeZone: string }> {
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
    };
  }
}

function assertEndsAfterStart(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) {
    throw HttpError.badRequest('The event must end after it starts', 'EVENT_ENDS_BEFORE_START');
  }
}
