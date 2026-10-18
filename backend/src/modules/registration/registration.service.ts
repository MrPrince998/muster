import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { TenantService } from '../../database/tenant.service.js';
import { EmailService } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import { EventService, eventNotFound } from '../event/event.service.js';
import type { MyRegistrationDto } from '../event/dto/event.dto.js';
import { EventStatus } from '../event/entities/event.entity.js';
import type { ClubAccess } from '../permission/club-access.js';
import type { CheckInResultDto, TicketDto, TicketWithCodeDto } from './dto/ticket.dto.js';
import { TicketService } from './ticket.service.js';

const ticketNotFound = () => HttpError.notFound("You don't have a ticket for this event", 'TICKET_NOT_FOUND');

interface TicketRow {
  registration_id: string;
  event_id: string;
  club_id: string;
  club_name: string;
  org_name: string;
  org_slug: string;
  event_title: string;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  event_status: EventStatus;
  attendee_name: string;
  checked_in_at: Date | null;
}

// Your active registrations with what a ticket shows. users is global (no
// RLS); registrations limits the join to this workspace.
const SELECT_TICKETS = `
  SELECT r.id AS registration_id, e.id AS event_id, c.id AS club_id, c.name AS club_name,
         o.name AS org_name, o.slug AS org_slug, e.title AS event_title, e.starts_at, e.ends_at,
         e.location, e.status AS event_status, u.name AS attendee_name, r.checked_in_at
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN clubs c ON c.id = e.club_id
  JOIN organisations o ON o.id = r.org_id
  JOIN users u ON u.id = r.user_id
  WHERE r.user_id = $1 AND r.cancelled_at IS NULL AND e.status <> 'draft'`;

const toTicket = (row: TicketRow): TicketDto => ({
  registrationId: row.registration_id,
  eventId: row.event_id,
  clubId: row.club_id,
  clubName: row.club_name,
  workspaceName: row.org_name,
  workspaceSlug: row.org_slug,
  eventTitle: row.event_title,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  location: row.location,
  eventCancelled: row.event_status === EventStatus.Cancelled,
  attendeeName: row.attendee_name,
  checkedInAt: row.checked_in_at,
});

@Injectable()
export class RegistrationService {
  constructor(
    private readonly events: EventService,
    private readonly tenant: TenantService,
    private readonly tickets: TicketService,
    private readonly email: EmailService,
  ) {}

  /**
   * Registers you for a published event that hasn't ended, if a place is
   * free. The event row is locked first (SELECT ... FOR UPDATE) and the
   * active registrations counted in the same transaction, so two people can
   * never take the last place at once. Registering again after cancelling
   * reactivates the same row, so the ticket id stays the same.
   *
   * Once committed, the ticket is emailed in the background: a provider
   * outage never undoes a registration (the ticket is in the app anyway).
   */
  async register(access: ClubAccess, eventId: string): Promise<MyRegistrationDto> {
    const { registration, ticket, email } = await this.events.inClub(access, async (m, orgId) => {
      const events: {
        status: EventStatus;
        ends_at: Date;
        capacity: number | null;
        registration_closed_at: Date | null;
      }[] = await m.query(
        `SELECT status, ends_at, capacity, registration_closed_at FROM events WHERE id = $1 AND club_id = $2 FOR UPDATE`,
        [eventId, access.clubId],
      );
      const event = events[0];
      // drafts are invisible to people registering
      if (!event || event.status === EventStatus.Draft) throw eventNotFound();
      if (event.status !== EventStatus.Published) {
        throw HttpError.conflict('This event is not open for registration', 'EVENT_NOT_OPEN');
      }
      if (event.ends_at <= new Date()) {
        throw HttpError.conflict('This event has ended', 'EVENT_ENDED');
      }
      if (event.registration_closed_at !== null) {
        throw HttpError.conflict('Registration for this event is closed', 'REGISTRATION_CLOSED');
      }

      const mine: { cancelled_at: Date | null }[] = await m.query(
        `SELECT cancelled_at FROM registrations WHERE event_id = $1 AND user_id = $2`,
        [eventId, access.userId],
      );
      if (mine[0] && mine[0].cancelled_at === null) {
        throw HttpError.conflict("You're already registered", 'ALREADY_REGISTERED');
      }

      if (event.capacity !== null) {
        const [{ count }]: { count: number }[] = await m.query(
          `SELECT count(*)::int AS count FROM registrations WHERE event_id = $1 AND cancelled_at IS NULL`,
          [eventId],
        );
        if (count >= event.capacity) {
          throw HttpError.conflict('This event is full', 'EVENT_FULL');
        }
      }

      const [row]: { id: string; event_id: string; created_at: Date }[] = await m.query(
        `INSERT INTO registrations (org_id, event_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT registrations_event_id_user_id_key
         DO UPDATE SET cancelled_at = NULL
         RETURNING id, event_id, created_at`,
        [orgId, eventId, access.userId],
      );
      const [details]: (TicketRow & { email: string })[] = await m.query(
        `${SELECT_TICKETS.replace('u.name AS attendee_name', 'u.name AS attendee_name, u.email')} AND r.id = $2`,
        [access.userId, row.id],
      );
      return {
        registration: { id: row.id, eventId: row.event_id, registeredAt: row.created_at },
        ticket: details,
        email: details.email,
      };
    });

    this.email.inBackground('ticket', this.emailTicket(ticket, email));
    return registration;
  }

  /** Gives your place back. Not possible once you've been checked in. */
  cancel(access: ClubAccess, eventId: string): Promise<void> {
    return this.events.inClub(access, async (m) => {
      const [rows]: [{ checked_in_at: Date | null }[], number] = await m.query(
        `UPDATE registrations r SET cancelled_at = now()
         FROM events e
         WHERE r.event_id = $1 AND r.user_id = $2 AND r.cancelled_at IS NULL AND r.checked_in_at IS NULL
           AND e.id = r.event_id AND e.club_id = $3
         RETURNING r.id`,
        [eventId, access.userId, access.clubId],
      );
      if (rows.length > 0) return;

      // nothing cancelled: say why
      const existing: { checked_in_at: Date | null }[] = await m.query(
        `SELECT r.checked_in_at FROM registrations r JOIN events e ON e.id = r.event_id
         WHERE r.event_id = $1 AND r.user_id = $2 AND r.cancelled_at IS NULL AND e.club_id = $3`,
        [eventId, access.userId, access.clubId],
      );
      if (existing[0]?.checked_in_at) {
        throw HttpError.conflict("You've already been checked in", 'ALREADY_CHECKED_IN');
      }
      throw HttpError.notFound("You're not registered for this event", 'REGISTRATION_NOT_FOUND');
    });
  }

  // --- tickets ---------------------------------------------------------------------

  /** Your ticket for one event, signed fresh, with its QR code. */
  myTicket(access: ClubAccess, eventId: string): Promise<TicketWithCodeDto> {
    return this.events.inClub(access, async (m) => {
      const rows: TicketRow[] = await m.query(`${SELECT_TICKETS} AND e.id = $2 AND e.club_id = $3`, [
        access.userId,
        eventId,
        access.clubId,
      ]);
      if (!rows[0]) throw ticketNotFound();
      return this.withCode(rows[0]);
    });
  }

  /**
   * Your tickets everywhere: events that haven't ended (or ended within the
   * last day), soonest first. Workspaces are separate tenants, so each is read
   * in its own tenant transaction; people belong to a handful at most.
   */
  async myTickets(user: AuthUser): Promise<TicketDto[]> {
    const workspaces = await this.tenant.userOrganisations(user.id);
    const perWorkspace = await Promise.all(
      workspaces.map((workspace) =>
        this.tenant.withTenant(workspace.orgId, async (m) => {
          const rows: TicketRow[] = await m.query(
            `${SELECT_TICKETS} AND e.ends_at > now() - interval '1 day' ORDER BY e.starts_at`,
            [user.id],
          );
          return rows.map(toTicket);
        }),
      ),
    );
    return perWorkspace.flat().sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  // --- check-in (checkin.scan) --------------------------------------------------------

  /**
   * Checks in the ticket a scanner read. The signature proves it's genuine;
   * the single conditional UPDATE proves it's unused, so the same ticket
   * scanned twice, or by two phones at once, gets in exactly once.
   */
  async checkIn(access: ClubAccess, eventId: string, token: string): Promise<CheckInResultDto> {
    const ticket = await this.tickets.verify(token);
    return this.events.inClub(access, async (m) => {
      await this.assertCheckInOpen(m, access, eventId);
      if (!ticket) return this.result(m, eventId, { outcome: 'invalid' });
      if (ticket.eventId !== eventId) return this.result(m, eventId, { outcome: 'wrong_event' });
      return this.admit(m, access, eventId, 'r.id = $1', ticket.registrationId);
    });
  }

  /** The door's fallback: check someone in from the attendee list. */
  manualCheckIn(access: ClubAccess, eventId: string, userId: string): Promise<CheckInResultDto> {
    return this.events.inClub(access, async (m) => {
      await this.assertCheckInOpen(m, access, eventId);
      return this.admit(m, access, eventId, 'r.user_id = $1', userId);
    });
  }

  // --- helpers ---------------------------------------------------------------------------

  // The atomic check-in, then, if it changed nothing, why not.
  private async admit(
    m: EntityManager,
    access: ClubAccess,
    eventId: string,
    match: 'r.id = $1' | 'r.user_id = $1',
    value: string,
  ): Promise<CheckInResultDto> {
    const [admitted]: [{ attendee_name: string; checked_in_at: Date }[], number] = await m.query(
      `UPDATE registrations r SET checked_in_at = now(), checked_in_by = $3
       FROM users u
       WHERE ${match} AND r.event_id = $2 AND r.checked_in_at IS NULL AND r.cancelled_at IS NULL
         AND u.id = r.user_id
       RETURNING u.name AS attendee_name, r.checked_in_at`,
      [value, eventId, access.userId],
    );
    if (admitted[0]) {
      return this.result(m, eventId, {
        outcome: 'checked_in',
        attendeeName: admitted[0].attendee_name,
        checkedInAt: admitted[0].checked_in_at,
      });
    }

    const rows: {
      attendee_name: string;
      cancelled_at: Date | null;
      checked_in_at: Date | null;
      scanner_name: string | null;
    }[] = await m.query(
      `SELECT u.name AS attendee_name, r.cancelled_at, r.checked_in_at, s.name AS scanner_name
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN users s ON s.id = r.checked_in_by
       WHERE ${match} AND r.event_id = $2`,
      [value, eventId],
    );
    const row = rows[0];
    // gone: a deleted registration, or one in another workspace (RLS hides it)
    if (!row) return this.result(m, eventId, { outcome: 'invalid' });
    if (row.checked_in_at) {
      return this.result(m, eventId, {
        outcome: 'already_checked_in',
        attendeeName: row.attendee_name,
        checkedInAt: row.checked_in_at,
        checkedInByName: row.scanner_name,
      });
    }
    return this.result(m, eventId, { outcome: 'cancelled', attendeeName: row.attendee_name });
  }

  // Check-in is for this club's published events; anything else is a 404/409.
  private async assertCheckInOpen(m: EntityManager, access: ClubAccess, eventId: string) {
    const rows: { status: EventStatus }[] = await m.query(`SELECT status FROM events WHERE id = $1 AND club_id = $2`, [
      eventId,
      access.clubId,
    ]);
    if (!rows[0] || rows[0].status === EventStatus.Draft) throw eventNotFound();
    if (rows[0].status === EventStatus.Cancelled) {
      throw HttpError.conflict('This event was cancelled', 'EVENT_CANCELLED');
    }
  }

  // Every answer carries the door's running count.
  private async result(
    m: EntityManager,
    eventId: string,
    result: Omit<CheckInResultDto, 'attendedCount' | 'registeredCount'>,
  ): Promise<CheckInResultDto> {
    const [counts]: { registered: number; attended: number }[] = await m.query(
      `SELECT count(*) FILTER (WHERE cancelled_at IS NULL)::int AS registered,
              count(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS attended
       FROM registrations WHERE event_id = $1`,
      [eventId],
    );
    return { ...result, attendedCount: counts.attended, registeredCount: counts.registered };
  }

  private async withCode(row: TicketRow): Promise<TicketWithCodeDto> {
    const token = await this.tickets.sign(row.registration_id, row.event_id, row.ends_at);
    return { ...toTicket(row), token, qrSvg: await this.tickets.qrSvg(token) };
  }

  private async emailTicket(row: TicketRow, to: string): Promise<void> {
    const token = await this.tickets.sign(row.registration_id, row.event_id, row.ends_at);
    await this.email.sendTicket({
      to,
      registrationId: row.registration_id,
      name: row.attendee_name,
      eventTitle: row.event_title,
      clubName: row.club_name,
      when: formatWhen(row.starts_at, row.ends_at),
      where: row.location,
      qrPng: await this.tickets.qrPng(token),
    });
  }
}
