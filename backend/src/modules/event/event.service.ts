import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { TenantService } from '../../database/tenant.service.js';
import type { ClubAccess } from '../permission/club-access.js';
import { Permission } from '../permission/permissions.js';
import type {
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
  registered_count: number;
  attended_count: number;
  youre_going: boolean;
}

// Every event read goes through this, so counts and "am I going" are always
// computed the same way. $1 is the club, $2 the current user.
const SELECT_EVENTS = `
  SELECT
    e.id, e.club_id, e.created_by, e.title, e.description, e.location,
    e.starts_at, e.ends_at, e.capacity, e.visibility, e.status,
    (SELECT count(*) FROM registrations r
      WHERE r.event_id = e.id AND r.cancelled_at IS NULL)::int          AS registered_count,
    (SELECT count(*) FROM registrations r
      WHERE r.event_id = e.id AND r.checked_in_at IS NOT NULL)::int     AS attended_count,
    EXISTS (SELECT 1 FROM registrations r
      WHERE r.event_id = e.id AND r.user_id = $2 AND r.cancelled_at IS NULL) AS youre_going
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
  constructor(private readonly tenant: TenantService) {}

  /**
   * A club's events in one of three lists. Drafts only include events you
   * could edit; members without event permissions get an empty list.
   */
  list(access: ClubAccess, scope: EventScope): Promise<EventDto[]> {
    return this.inClub(access, async (m) => {
      let where: string;
      const params: unknown[] = [access.clubId, access.userId];
      switch (scope) {
        case 'upcoming':
          where = `AND e.status = 'published' AND e.ends_at > now() ORDER BY e.starts_at`;
          break;
        case 'past':
          where = `AND e.status = 'published' AND e.ends_at <= now() ORDER BY e.starts_at DESC`;
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
   * capacity can't drop below the people already registered.
   */
  update(access: ClubAccess, eventId: string, dto: UpdateEventDto): Promise<EventDto> {
    return this.inClub(access, async (m) => {
      // locked, so a registration can't slip in between the capacity check and the update
      const event = await this.lockForManage(m, access, eventId);

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

      await m.query(
        `UPDATE events SET
           title = $2, description = $3, location = $4,
           starts_at = $5, ends_at = $6, capacity = $7, visibility = $8
         WHERE id = $1`,
        [
          eventId,
          dto.title?.trim() ?? event.title,
          dto.description === undefined ? event.description : dto.description.trim() || null,
          dto.location === undefined ? event.location : dto.location.trim() || null,
          startsAt,
          endsAt,
          capacity,
          dto.visibility ?? event.visibility,
        ],
      );
      return this.findOne(m, access, eventId);
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
      registeredCount: row.registered_count ?? 0,
      attendedCount: row.attended_count ?? 0,
      youreGoing: row.youre_going ?? false,
      canManage: canManage(access, row.created_by),
    };
  }
}

function assertEndsAfterStart(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) {
    throw HttpError.badRequest('The event must end after it starts', 'EVENT_ENDS_BEFORE_START');
  }
}
