import { HttpError } from '../../common/errors/http-error.js';
import type { TenantService } from '../../database/tenant.service.js';
import type { EmailService } from '../email/email.service.js';
import type { EventService } from '../event/event.service.js';
import { ClubAccess } from '../permission/club-access.js';
import { Permission } from '../permission/permissions.js';
import { RegistrationService } from './registration.service.js';
import type { TicketService } from '../ticket/ticket.service.js';
import type { WaitlistService } from '../waitlist/waitlist.service.js';

const scanner = new ClubAccess('club1', 'u-scanner', false, 20, [Permission.CheckinScan]);
const counts = [{ registered: 10, attended: 4 }];

/**
 * A fake database (each query matched by a fragment of its SQL) and a fake
 * ticket verifier, so each test sets up exactly one door situation.
 */
function setup(answers: [fragment: string, answer: unknown][], ticket: { registrationId: string; eventId: string } | null) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const match = answers.find(([fragment]) => sql.includes(fragment));
      return match ? match[1] : [];
    }),
  };
  const events = { inClub: vi.fn((_access: ClubAccess, work: (m: typeof manager, orgId: string) => unknown) => work(manager, 'org1')) };
  const tickets = { verify: vi.fn().mockResolvedValue(ticket) };
  const service = new RegistrationService(
    events as unknown as EventService,
    {} as TenantService,
    tickets as unknown as TicketService,
    {} as EmailService,
    {} as WaitlistService,
  );
  return { service, ran: (fragment: string) => calls.filter((c) => c.sql.includes(fragment)) };
}

const published = ['SELECT status FROM events', [{ status: 'published' }]] as [string, unknown];
const countsAnswer = ['FILTER (WHERE cancelled_at IS NULL)', counts] as [string, unknown];
const genuine = { registrationId: 'reg1', eventId: 'ev1' };

describe('RegistrationService.checkIn', () => {
  it('lets a genuine, unused ticket in, recording who scanned it', async () => {
    const now = new Date();
    const { service, ran } = setup(
      [published, ['UPDATE registrations r SET checked_in_at', [[{ attendee_name: 'Ada', checked_in_at: now }], 1]], countsAnswer],
      genuine,
    );
    await expect(service.checkIn(scanner, 'ev1', 'token')).resolves.toEqual({
      outcome: 'checked_in',
      attendeeName: 'Ada',
      checkedInAt: now,
      attendedCount: 4,
      registeredCount: 10,
    });
    const update = ran('UPDATE registrations r SET checked_in_at')[0];
    // the single conditional update that makes double entry impossible
    expect(update.sql).toContain('r.checked_in_at IS NULL AND r.cancelled_at IS NULL');
    expect(update.params).toEqual(['reg1', 'ev1', 'u-scanner']);
  });

  it('says when and by whom an already-used ticket got in', async () => {
    const earlier = new Date(Date.now() - 600_000);
    const { service } = setup(
      [
        published,
        ['UPDATE registrations r SET checked_in_at', [[], 0]],
        ['s.name AS scanner_name', [{ attendee_name: 'Ada', cancelled_at: null, checked_in_at: earlier, scanner_name: 'Sam' }]],
        countsAnswer,
      ],
      genuine,
    );
    await expect(service.checkIn(scanner, 'ev1', 'token')).resolves.toMatchObject({
      outcome: 'already_checked_in',
      attendeeName: 'Ada',
      checkedInAt: earlier,
      checkedInByName: 'Sam',
    });
  });

  it('turns away a cancelled registration', async () => {
    const { service } = setup(
      [
        published,
        ['UPDATE registrations r SET checked_in_at', [[], 0]],
        ['s.name AS scanner_name', [{ attendee_name: 'Ada', cancelled_at: new Date(), checked_in_at: null, scanner_name: null }]],
        countsAnswer,
      ],
      genuine,
    );
    await expect(service.checkIn(scanner, 'ev1', 'token')).resolves.toMatchObject({ outcome: 'cancelled', attendeeName: 'Ada' });
  });

  it('spots a genuine ticket for another event without touching any registration', async () => {
    const { service, ran } = setup([published, countsAnswer], { registrationId: 'reg1', eventId: 'other-event' });
    await expect(service.checkIn(scanner, 'ev1', 'token')).resolves.toMatchObject({ outcome: 'wrong_event' });
    expect(ran('UPDATE registrations')).toHaveLength(0);
  });

  it('calls a forged or damaged ticket invalid', async () => {
    const { service, ran } = setup([published, countsAnswer], null);
    await expect(service.checkIn(scanner, 'ev1', 'garbage')).resolves.toMatchObject({ outcome: 'invalid' });
    expect(ran('UPDATE registrations')).toHaveLength(0);
  });

  it('calls a signed ticket whose registration is gone (or in another workspace) invalid', async () => {
    const { service } = setup(
      [published, ['UPDATE registrations r SET checked_in_at', [[], 0]], ['s.name AS scanner_name', []], countsAnswer],
      genuine,
    );
    await expect(service.checkIn(scanner, 'ev1', 'token')).resolves.toMatchObject({ outcome: 'invalid' });
  });

  it('refuses check-in for a cancelled event', async () => {
    const { service } = setup([['SELECT status FROM events', [{ status: 'cancelled' }]]], genuine);
    const error = await service.checkIn(scanner, 'ev1', 'token').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 409, code: 'EVENT_CANCELLED' });
  });

  it('treats a draft, or another club’s event, as not found', async () => {
    for (const rows of [[{ status: 'draft' }], []]) {
      const { service } = setup([['SELECT status FROM events', rows]], genuine);
      const error = await service.checkIn(scanner, 'ev1', 'token').catch((e: unknown) => e);
      expect(error).toMatchObject({ statusCode: 404, code: 'EVENT_NOT_FOUND' });
    }
  });
});

describe('RegistrationService.manualCheckIn', () => {
  it('checks someone in by their user id, through the same atomic update', async () => {
    const { service, ran } = setup(
      [published, ['UPDATE registrations r SET checked_in_at', [[{ attendee_name: 'Ada', checked_in_at: new Date() }], 1]], countsAnswer],
      null,
    );
    await expect(service.manualCheckIn(scanner, 'ev1', 'u-ada')).resolves.toMatchObject({ outcome: 'checked_in' });
    const update = ran('UPDATE registrations r SET checked_in_at')[0];
    expect(update.sql).toContain('r.user_id = $1');
    expect(update.params).toEqual(['u-ada', 'ev1', 'u-scanner']);
  });
});
