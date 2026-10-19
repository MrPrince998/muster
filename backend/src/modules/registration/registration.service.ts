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
import type {
  CheckInResultDto,
  DoorRosterDto,
  OfflineCheckInDto,
  SyncResultDto,
  TicketDto,
  TicketWithCodeDto,
} from './dto/ticket.dto.js';
import { TicketService } from '../ticket/ticket.service.js';
import { WaitlistService, waitingCount } from '../waitlist/waitlist.service.js';
import { audit, AuditAction } from '../audit/audit.js';

const ticketNotFound = () => HttpError.notFound("You don't have a ticket for this event", 'TICKET_NOT_FOUND');

export interface TicketRow {
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
  time_zone: string;
}

// Your active registrations with what a ticket shows. users is global (no
// RLS); registrations limits the join to this workspace.
const SELECT_TICKETS = `
  SELECT r.id AS registration_id, e.id AS event_id, c.id AS club_id, c.name AS club_name,
         o.name AS org_name, o.slug AS org_slug, e.title AS event_title, e.starts_at, e.ends_at,
         e.location, e.status AS event_status, u.name AS attendee_name, r.checked_in_at, o.time_zone
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN clubs c ON c.id = e.club_id
  JOIN organisations o ON o.id = r.org_id
  JOIN users u ON u.id = r.user_id
  WHERE r.user_id = $1 AND r.cancelled_at IS NULL AND e.status <> 'draft'`;

export const toTicket = (row: TicketRow): TicketDto => ({
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
  timeZone: row.time_zone,
});

/**
 * Takes a place at an event for someone, inside the caller's tenant
 * transaction: the event row is locked, so the capacity check and the insert
 * can't interleave with another registration (README: "Concurrency-safe
 * operations"). Members come through their club (`clubId`); guests through a
 * public event's page (`publicOnly`), where anything not public is "not found".
 * With `alreadyOk`, someone already registered gets their place back instead
 * of an error (a confirmation link clicked twice).
 */
export async function takePlace(
  m: EntityManager,
  place: { orgId: string; eventId: string; userId: string; clubId?: string; publicOnly?: boolean; alreadyOk?: boolean },
): Promise<{ id: string; event_id: string; created_at: Date; isNew: boolean }> {
  const events: {
    status: EventStatus;
    ends_at: Date;
    capacity: number | null;
    registration_closed_at: Date | null;
    visibility: string;
  }[] = await m.query(
    `SELECT status, ends_at, capacity, registration_closed_at, visibility FROM events
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
    if (place.alreadyOk) return { id: mine[0].id, event_id: place.eventId, created_at: mine[0].created_at, isNew: false };
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
  if (event.capacity !== null) {
    const [{ count }]: { count: number }[] = await m.query(
      `SELECT count(*)::int AS count FROM registrations WHERE event_id = $1 AND cancelled_at IS NULL`,
      [place.eventId],
    );
    if (count >= event.capacity) {
      throw HttpError.conflict('This event is full', 'EVENT_FULL');
    }
  }
  // a place freed while people are waiting is theirs: no jumping the queue
  if ((await waitingCount(m, place.eventId)) > 0) {
    throw HttpError.conflict('This event is full', 'EVENT_FULL');
  }

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

@Injectable()
export class RegistrationService {
  constructor(
    private readonly events: EventService,
    private readonly tenant: TenantService,
    private readonly tickets: TicketService,
    private readonly email: EmailService,
    private readonly waitlist: WaitlistService,
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
      const row = await takePlace(m, { orgId, eventId, userId: access.userId, clubId: access.clubId });
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
  async cancel(access: ClubAccess, eventId: string): Promise<void> {
    const orgId = await this.events.inClub(access, async (m, orgId) => {
      const [rows]: [{ checked_in_at: Date | null }[], number] = await m.query(
        `UPDATE registrations r SET cancelled_at = now()
         FROM events e
         WHERE r.event_id = $1 AND r.user_id = $2 AND r.cancelled_at IS NULL AND r.checked_in_at IS NULL
           AND e.id = r.event_id AND e.club_id = $3
         RETURNING r.id`,
        [eventId, access.userId, access.clubId],
      );
      if (rows.length > 0) return orgId;

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
    // the freed place goes to whoever has waited longest
    await this.waitlist.promote(orgId, eventId);
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
    // your workspaces, plus any you hold a ticket in without being a member
    // (a public event you registered for as a guest)
    const orgIds = new Set([
      ...(await this.tenant.userOrganisations(user.id)).map((w) => w.orgId),
      ...(await this.tenant.userTicketOrganisations(user.id)),
    ]);
    const perWorkspace = await Promise.all(
      [...orgIds].map((orgId) =>
        this.tenant.withTenant(orgId, async (m) => {
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
      const result = await this.admit(m, access, eventId, 'r.user_id = $1', userId);
      // no ticket was shown: the log says who let them in
      if (result.outcome === 'checked_in') {
        await audit(m, { actorId: access.userId, action: AuditAction.EventManualCheckIn, clubId: access.clubId, eventId, subjectUserId: userId });
      }
      return result;
    });
  }

  /**
   * The door's list, for a scanner to keep going with no connection: every
   * ticket's registration id, whose it is, and whether it's used or given
   * back. Offline, the scanner can't check a code's signature (the secret
   * never leaves the server), so it relies on the registration id inside:
   * random, and only on that person's ticket. The sync then decides, as a
   * scan would.
   */
  roster(access: ClubAccess, eventId: string): Promise<DoorRosterDto> {
    return this.events.inClub(access, async (m) => {
      await this.assertCheckInOpen(m, access, eventId);
      const rows: { id: string; user_id: string; name: string; checked_in_at: Date | null; cancelled: boolean }[] =
        await m.query(
          `SELECT r.id, r.user_id, u.name, r.checked_in_at, (r.cancelled_at IS NOT NULL) AS cancelled
           FROM registrations r JOIN users u ON u.id = r.user_id
           WHERE r.event_id = $1
           ORDER BY lower(u.name)`,
          [eventId],
        );
      return {
        eventId,
        generatedAt: new Date(),
        tickets: rows.map((r) => ({
          registrationId: r.id,
          userId: r.user_id,
          name: r.name,
          checkedInAt: r.checked_in_at,
          cancelled: r.cancelled,
        })),
      };
    });
  }

  /**
   * What a scanner let in while offline, sent once it's back. Each goes
   * through the same atomic check-in as a scan, at the time the door saw
   * it; a ticket another door used first comes back already_checked_in, so
   * the scanner can say so.
   */
  syncCheckIns(access: ClubAccess, eventId: string, checkIns: OfflineCheckInDto[]): Promise<SyncResultDto> {
    return this.events.inClub(access, async (m) => {
      await this.assertCheckInOpen(m, access, eventId);
      const results: SyncResultDto['results'] = [];
      for (const { registrationId, at } of checkIns) {
        const { outcome, ...rest } = await this.admitOne(m, access, eventId, 'r.id = $1', registrationId, new Date(at));
        // a registration id can't belong to another event here: the lookup is by this event
        results.push({ registrationId, outcome: outcome === 'wrong_event' ? 'invalid' : outcome, ...rest });
      }
      return { results, ...(await this.counts(m, eventId)) };
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
    return this.result(m, eventId, await this.admitOne(m, access, eventId, match, value));
  }

  // One check-in, without the counts. `at` (a scanner's offline time) never lies in the future.
  private async admitOne(
    m: EntityManager,
    access: ClubAccess,
    eventId: string,
    match: 'r.id = $1' | 'r.user_id = $1',
    value: string,
    at?: Date,
  ): Promise<Omit<CheckInResultDto, 'attendedCount' | 'registeredCount'>> {
    const [admitted]: [{ attendee_name: string; checked_in_at: Date }[], number] = await m.query(
      `UPDATE registrations r SET checked_in_at = LEAST(COALESCE($4::timestamptz, now()), now()), checked_in_by = $3
       FROM users u
       WHERE ${match} AND r.event_id = $2 AND r.checked_in_at IS NULL AND r.cancelled_at IS NULL
         AND u.id = r.user_id
       RETURNING u.name AS attendee_name, r.checked_in_at`,
      [value, eventId, access.userId, at ?? null],
    );
    if (admitted[0]) {
      return { outcome: 'checked_in', attendeeName: admitted[0].attendee_name, checkedInAt: admitted[0].checked_in_at };
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
    if (!row) return { outcome: 'invalid' };
    if (row.checked_in_at) {
      return {
        outcome: 'already_checked_in',
        attendeeName: row.attendee_name,
        checkedInAt: row.checked_in_at,
        checkedInByName: row.scanner_name,
      };
    }
    return { outcome: 'cancelled', attendeeName: row.attendee_name };
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
    return { ...result, ...(await this.counts(m, eventId)) };
  }

  private async counts(m: EntityManager, eventId: string): Promise<{ attendedCount: number; registeredCount: number }> {
    const [counts]: { registered: number; attended: number }[] = await m.query(
      `SELECT count(*) FILTER (WHERE cancelled_at IS NULL)::int AS registered,
              count(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS attended
       FROM registrations WHERE event_id = $1`,
      [eventId],
    );
    return { attendedCount: counts.attended, registeredCount: counts.registered };
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
      when: formatWhen(row.starts_at, row.ends_at, row.time_zone),
      where: row.location,
      qrPng: await this.tickets.qrPng(token),
      calendar: { eventId: row.event_id, startsAt: row.starts_at, endsAt: row.ends_at },
    });
  }
}
