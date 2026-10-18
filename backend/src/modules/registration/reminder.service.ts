import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';
import { BULK_PACE_MS, EmailService } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import { TicketService } from './ticket.service.js';

// a reminder is due once the event is this close...
export const REMINDER_WITHIN = '24 hours';
// ...unless it's about to start anyway (a late reminder only adds noise)
export const REMINDER_MIN_AHEAD = '30 minutes';
// how often the job looks; well under the window, so a restart loses nothing
const EVERY_MS = 10 * 60_000;
// a batch per workspace per round; the next round takes the rest
const BATCH = 500;

interface DueRow {
  registration_id: string;
  event_id: string;
  event_title: string;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  club_name: string;
  email: string;
  name: string;
  // no password: a guest, whose way back to the ticket is its own page
  guest: boolean;
}

// Takes the due places in this workspace and marks them reminded, in one
// statement: whatever else is running the job (another copy of the API) skips
// rows already taken (SKIP LOCKED) and can't claim them a second time.
const CLAIM = `
  UPDATE registrations r SET reminder_sent_at = now()
  FROM events e, clubs c, users u
  WHERE r.id IN (
          SELECT r2.id FROM registrations r2 JOIN events e2 ON e2.id = r2.event_id
          WHERE e2.status = 'published'
            AND e2.starts_at > now() + $2::interval
            AND e2.starts_at <= now() + $1::interval
            AND r2.cancelled_at IS NULL AND r2.checked_in_at IS NULL AND r2.reminder_sent_at IS NULL
            AND r2.created_at <= e2.starts_at - $1::interval
          ORDER BY e2.starts_at
          LIMIT ${BATCH}
          FOR UPDATE OF r2 SKIP LOCKED)
    AND e.id = r.event_id AND c.id = e.club_id AND u.id = r.user_id
  RETURNING r.id AS registration_id, e.id AS event_id, e.title AS event_title, e.starts_at, e.ends_at,
            e.location, c.name AS club_name, u.email, u.name, (u.password_hash IS NULL) AS guest`;

/**
 * The day-before reminder (README: "Registration to check-in flow"): everyone
 * with a place at an event starting within a day gets their ticket again,
 * once. Places taken within that day are skipped; their ticket email has
 * only just arrived.
 *
 * Runs every few minutes inside the API. Claiming before sending keeps it to
 * one email per place, even across several copies of the API; a send that
 * fails gives its claim back, so the next round tries again.
 */
@Injectable()
export class ReminderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReminderService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly tenant: TenantService,
    private readonly tickets: TicketService,
    private readonly email: EmailService,
    @Inject(BULK_PACE_MS) private readonly paceMs: number,
  ) {}

  onApplicationBootstrap(): void {
    // tests run it by hand; a timer would race them
    if (!config.reminders.enabled || process.env.VITEST) return;
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
    this.timer.unref();
    // a first round soon after starting, not a full interval later
    setTimeout(() => void this.tick(), 60_000).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** One round: claims and sends everything due. Returns how many went out. */
  async sendDue(): Promise<number> {
    let sent = 0;
    for (const orgId of await this.tenant.dueReminderOrganisations(REMINDER_WITHIN, REMINDER_MIN_AHEAD)) {
      const [due]: [DueRow[], number] = await this.tenant.withTenant(orgId, (m) =>
        m.query(CLAIM, [REMINDER_WITHIN, REMINDER_MIN_AHEAD]),
      );
      for (const row of due) {
        if (sent > 0 && this.paceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
        try {
          await this.send(row);
          sent++;
        } catch (error) {
          this.logger.error(`Reminder for ${row.registration_id} failed; will retry`, error instanceof Error ? error.stack : error);
          await this.tenant.withTenant(orgId, (m) =>
            m.query(`UPDATE registrations SET reminder_sent_at = NULL WHERE id = $1`, [row.registration_id]),
          );
        }
      }
    }
    if (sent > 0) this.logger.log(`Sent ${sent} event reminder${sent === 1 ? '' : 's'}`);
    return sent;
  }

  private async tick(): Promise<void> {
    // one round at a time: a slow round (many emails) isn't joined by the next
    if (this.running) return;
    this.running = true;
    try {
      await this.sendDue();
    } catch (error) {
      this.logger.error('Reminder round failed', error instanceof Error ? error.stack : error);
    } finally {
      this.running = false;
    }
  }

  private async send(row: DueRow): Promise<void> {
    const token = await this.tickets.sign(row.registration_id, row.event_id, row.ends_at);
    await this.email.sendReminder({
      to: row.email,
      registrationId: row.registration_id,
      guestToken: row.guest ? token : undefined,
      name: row.name,
      eventTitle: row.event_title,
      clubName: row.club_name,
      when: formatWhen(row.starts_at, row.ends_at),
      where: row.location,
      qrPng: await this.tickets.qrPng(token),
    });
  }
}
