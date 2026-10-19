import type { TenantService } from '../../database/tenant.service.js';
import type { EmailService } from '../email/email.service.js';
import { ClubAccess } from '../permission/club-access.js';
import type { PaymentService } from '../payment/payment.service.js';
import type { WaitlistService } from '../waitlist/waitlist.service.js';
import { Permission } from '../permission/permissions.js';
import { EventService } from './event.service.js';

const organiser = new ClubAccess('club1', 'u-org', false, 10, [Permission.EventManageAny]);
const member = new ClubAccess('club1', 'u-member', false, 0, []);

const hour = 3_600_000;
const tomorrow = new Date(Date.now() + 24 * hour);
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'ev1',
  club_id: 'club1',
  created_by: 'u-org',
  title: 'Demo Night',
  description: null,
  location: 'Hall B',
  starts_at: tomorrow,
  ends_at: new Date(tomorrow.getTime() + 3 * hour),
  capacity: null,
  visibility: 'members',
  status: 'published',
  registration_closed_at: null,
  cancelled_at: null,
  cancel_reason: null,
  registered_count: 2,
  attended_count: 0,
  youre_going: false,
  ...overrides,
});
const people = [
  { id: 'reg1', email: 'ada@uni.edu', name: 'Ada' },
  { id: 'reg2', email: 'sam@uni.edu', name: 'Sam' },
];

/** A fake database: each query answered by the first answer whose SQL fragment it contains. */
function setup(event: ReturnType<typeof row>, after: ReturnType<typeof row> = event, attendees = people) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const answers: [string, unknown][] = [
    ['FOR UPDATE', [event]],
    ['FROM registrations r JOIN users u', attendees],
    ['FROM clubs c JOIN organisations o', [{ name: 'Robotics', slug: 'csu' }]],
    ['AS youre_going', [after]],
    ['count(*)::int AS count', [{ count: attendees.length }]],
  ];
  const manager = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return answers.find(([fragment]) => sql.includes(fragment))?.[1] ?? [];
    }),
  };
  const tenant = {
    orgIdForClub: vi.fn().mockResolvedValue('org1'),
    withTenant: vi.fn((_org: string, work: (m: typeof manager) => unknown) => work(manager)),
  };
  const email = {
    inBackground: vi.fn(),
    sendEventCancelled: vi.fn().mockResolvedValue(undefined),
    sendEventChanged: vi.fn().mockResolvedValue(undefined),
  };
  const waitlist = { promote: vi.fn().mockResolvedValue(undefined) };
  // free events: no prices, nothing to refund
  const payments = {
    priceFor: vi.fn().mockResolvedValue({ priceCents: null, currency: null }),
    refundEvent: vi.fn().mockResolvedValue(undefined),
  };
  const service = new EventService(
    tenant as unknown as TenantService,
    email as unknown as EmailService,
    waitlist as unknown as WaitlistService,
    payments as unknown as PaymentService,
  );
  return { service, email, waitlist, ran: (fragment: string) => calls.filter((c) => c.sql.includes(fragment)) };
}

describe('EventService.cancel', () => {
  it('cancels, keeps the note, and emails everyone registered', async () => {
    const { service, email, ran } = setup(row(), row({ status: 'cancelled', cancel_reason: 'Speaker is ill' }));
    const result = await service.cancel(organiser, 'ev1', { reason: '  Speaker is ill  ' });

    expect(result).toMatchObject({ status: 'cancelled', cancelReason: 'Speaker is ill' });
    expect(ran("SET status = 'cancelled'")[0].params).toEqual(['ev1', 'Speaker is ill']);
    expect(email.sendEventCancelled).toHaveBeenCalledWith(
      [
        { registrationId: 'reg1', to: 'ada@uni.edu', name: 'Ada' },
        { registrationId: 'reg2', to: 'sam@uni.edu', name: 'Sam' },
      ],
      expect.objectContaining({ eventTitle: 'Demo Night', clubName: 'Robotics', orgSlug: 'csu', reason: 'Speaker is ill' }),
    );
    expect(email.inBackground).toHaveBeenCalledWith('event cancelled', expect.any(Promise));
  });

  it('sends nothing when nobody registered, and stores no empty note', async () => {
    const { service, email, ran } = setup(row(), row({ status: 'cancelled' }), []);
    await service.cancel(organiser, 'ev1', { reason: '   ' });
    expect(ran("SET status = 'cancelled'")[0].params).toEqual(['ev1', null]);
    expect(email.sendEventCancelled).not.toHaveBeenCalled();
  });

  it.each([
    ['a draft', row({ status: 'draft' }), 'EVENT_IS_DRAFT'],
    ['an already cancelled event', row({ status: 'cancelled' }), 'EVENT_ALREADY_CANCELLED'],
    [
      'an event that is over',
      row({ starts_at: new Date(Date.now() - 5 * hour), ends_at: new Date(Date.now() - hour) }),
      'EVENT_ENDED',
    ],
  ])('refuses %s', async (_name, event, code) => {
    const { service, email, ran } = setup(event);
    await expect(service.cancel(organiser, 'ev1', {})).rejects.toMatchObject({ code });
    expect(ran("SET status = 'cancelled'")).toHaveLength(0);
    expect(email.sendEventCancelled).not.toHaveBeenCalled();
  });

  it("refuses someone who can't manage the event", async () => {
    const { service } = setup(row());
    await expect(service.cancel(member, 'ev1', {})).rejects.toMatchObject({ code: 'MISSING_PERMISSION' });
  });
});

describe('EventService.remove', () => {
  it('deletes a draft', async () => {
    const { service, ran } = setup(row({ status: 'draft', registered_count: 0 }));
    await service.remove(organiser, 'ev1');
    expect(ran('DELETE FROM events')[0].params).toEqual([['ev1']]);
  });

  it('refuses a published event: those are cancelled, so the history stays', async () => {
    const { service, ran } = setup(row());
    await expect(service.remove(organiser, 'ev1')).rejects.toMatchObject({ code: 'EVENT_NOT_DRAFT' });
    expect(ran('DELETE FROM events')).toHaveLength(0);
  });
});

describe('EventService.update', () => {
  const later = new Date(tomorrow.getTime() + 2 * hour);
  const laterEnd = new Date(later.getTime() + 3 * hour);

  it('emails everyone registered when the time moves, with the old time', async () => {
    const { service, email } = setup(row(), row({ starts_at: later, ends_at: laterEnd }));
    await service.update(organiser, 'ev1', { startsAt: later.toISOString(), endsAt: laterEnd.toISOString() });
    expect(email.sendEventChanged).toHaveBeenCalledTimes(1);
    const [recipients, details] = email.sendEventChanged.mock.calls[0];
    expect(recipients).toHaveLength(2);
    expect(details.before.when).toEqual(expect.any(String));
    expect(details.before).not.toHaveProperty('where');
  });

  it('emails about a new place, with the old one', async () => {
    const { service, email } = setup(row(), row({ location: 'Library' }));
    await service.update(organiser, 'ev1', { location: 'Library' });
    expect(email.sendEventChanged.mock.calls[0][1]).toMatchObject({ where: 'Library', before: { where: 'Hall B' } });
  });

  it("doesn't email for a new title, or for any change to a draft", async () => {
    const titled = setup(row(), row({ title: 'Demo Night 2' }));
    await titled.service.update(organiser, 'ev1', { title: 'Demo Night 2' });
    expect(titled.email.sendEventChanged).not.toHaveBeenCalled();

    const draft = setup(row({ status: 'draft' }), row({ status: 'draft', location: 'Library' }));
    await draft.service.update(organiser, 'ev1', { location: 'Library' });
    expect(draft.email.sendEventChanged).not.toHaveBeenCalled();
  });

  it('closes registration (keeping the first close time) and opens it again', async () => {
    const closing = setup(row());
    await closing.service.update(organiser, 'ev1', { registrationOpen: false });
    expect(closing.ran('UPDATE events SET')[0].params[8]).toBeInstanceOf(Date);

    const firstClosed = new Date(Date.now() - hour);
    const again = setup(row({ registration_closed_at: firstClosed }));
    await again.service.update(organiser, 'ev1', { registrationOpen: false });
    expect(again.ran('UPDATE events SET')[0].params[8]).toBe(firstClosed);

    const opening = setup(row({ registration_closed_at: firstClosed }));
    await opening.service.update(organiser, 'ev1', { registrationOpen: true });
    expect(opening.ran('UPDATE events SET')[0].params[8]).toBeNull();
  });

  it("refuses to change a cancelled event", async () => {
    const { service, ran } = setup(row({ status: 'cancelled' }));
    await expect(service.update(organiser, 'ev1', { title: 'Back on' })).rejects.toMatchObject({ code: 'EVENT_CANCELLED' });
    expect(ran('UPDATE events SET')).toHaveLength(0);
  });
});
