import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';
import type { ClubAccess } from '../permission/club-access.js';
import type { AttendanceEventDto, AttendanceMonthDto, ClubAttendanceDto } from './dto/analytics.dto.js';

// per event: active places, people checked in, and places held by people
// outside the workspace (guests at public events); $1 the club
const PER_EVENT = `
  SELECT e.id, e.title, e.starts_at, e.status, e.ends_at <= now() AS ended, e.capacity,
         count(r.id) FILTER (WHERE r.cancelled_at IS NULL)::int                          AS registered,
         count(r.id) FILTER (WHERE r.cancelled_at IS NULL AND r.checked_in_at IS NOT NULL)::int AS attended,
         count(r.id) FILTER (WHERE r.cancelled_at IS NULL AND NOT EXISTS (
           SELECT 1 FROM org_members om WHERE om.org_id = r.org_id AND om.user_id = r.user_id))::int AS guests
  FROM events e
  LEFT JOIN registrations r ON r.event_id = e.id
  WHERE e.club_id = $1 AND e.status <> 'draft'
  GROUP BY e.id`;

interface EventRow {
  id: string;
  title: string;
  starts_at: Date;
  status: 'published' | 'cancelled';
  ended: boolean;
  capacity: number | null;
  registered: number;
  attended: number;
  guests: number;
}

/**
 * Attendance for organisers (README: "analytics are computed by SQL queries
 * rather than saved"): nothing is stored, every number comes from events and
 * registrations as they are now. Runs in the club's workspace (RLS).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly tenant: TenantService) {}

  attendance(access: ClubAccess): Promise<ClubAttendanceDto> {
    return this.inClub(access.clubId, async (m) => {
      const events: EventRow[] = await m.query(`${PER_EVENT} ORDER BY e.starts_at DESC`, [access.clubId]);

      // the last 12 months in the app's time zone, empty ones included
      const months: { month: string; events: number; registered: number; attended: number }[] = await m.query(
        `WITH per_event AS (${PER_EVENT}),
              span AS (
                SELECT generate_series(
                  date_trunc('month', now() AT TIME ZONE $2) - interval '11 months',
                  date_trunc('month', now() AT TIME ZONE $2),
                  interval '1 month') AS month
              )
         SELECT to_char(span.month, 'YYYY-MM') AS month,
                count(pe.id)::int                     AS events,
                COALESCE(sum(pe.registered), 0)::int  AS registered,
                COALESCE(sum(pe.attended), 0)::int    AS attended
         FROM span
         LEFT JOIN per_event pe
           ON date_trunc('month', pe.starts_at AT TIME ZONE $2) = span.month
          AND pe.status = 'published' AND pe.ended
         GROUP BY span.month
         ORDER BY span.month`,
        [access.clubId, config.timeZone],
      );

      // held: published and over (a cancelled event never happened)
      const held = events.filter((e) => e.status === 'published' && e.ended);
      const registered = sum(held, 'registered');
      const attended = sum(held, 'attended');
      return {
        summary: {
          eventsHeld: held.length,
          upcomingEvents: events.filter((e) => e.status === 'published' && !e.ended).length,
          registered,
          attended,
          attendanceRate: registered === 0 ? null : attended / registered,
          guests: sum(held, 'guests'),
        },
        months: months satisfies AttendanceMonthDto[],
        events: events.slice(0, 50).map(
          (e): AttendanceEventDto => ({
            id: e.id,
            title: e.title,
            startsAt: e.starts_at,
            status: e.status,
            ended: e.ended,
            capacity: e.capacity,
            registered: e.registered,
            attended: e.attended,
            guests: e.guests,
          }),
        ),
      };
    });
  }

  private async inClub<T>(clubId: string, work: (m: EntityManager) => Promise<T>): Promise<T> {
    const orgId = await this.tenant.orgIdForClub(clubId);
    if (!orgId) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
    return this.tenant.withTenant(orgId, work);
  }
}

const sum = (rows: EventRow[], key: 'registered' | 'attended' | 'guests') => rows.reduce((total, row) => total + row[key], 0);
