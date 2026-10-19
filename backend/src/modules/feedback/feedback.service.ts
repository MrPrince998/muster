import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';
import { BULK_PACE_MS, EmailService } from '../email/email.service.js';
import { eventNotFound } from '../event/event.service.js';
import type { ClubAccess } from '../permission/club-access.js';
import type { FeedbackFormDto, FeedbackSummaryDto, GiveFeedbackDto } from './dto/feedback.dto.js';

// asked a couple of hours after it ends (people are home), for three days after
export const FEEDBACK_AFTER = '2 hours';
export const FEEDBACK_WITHIN = '3 days';
// answers taken (and changed) for a month
const OPEN_FOR_DAYS = 30;
const EVERY_MS = 15 * 60_000;
const BATCH = 500;

const notFound = () => HttpError.notFound('No such feedback link', 'FEEDBACK_NOT_FOUND');

interface DueRow {
  registration_id: string;
  event_id: string;
  event_title: string;
  club_name: string;
  email: string;
  name: string;
}

/**
 * "How was it?" A couple of hours after an event ends, everyone who came in
 * is asked once, by email (claimed before sending, like reminders). The link
 * is their answer form, no sign-in: an HMAC of their place. Organisers see
 * the answers without names.
 */
@Injectable()
export class FeedbackService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FeedbackService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly tenant: TenantService,
    private readonly email: EmailService,
    @Inject(BULK_PACE_MS) private readonly paceMs: number,
  ) {}

  onApplicationBootstrap(): void {
    if (!config.reminders.enabled || process.env.VITEST) return;
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** One round: asks everyone due. Returns how many emails went out. */
  async requestDue(): Promise<number> {
    let sent = 0;
    for (const orgId of await this.tenant.dueFeedbackOrganisations(FEEDBACK_AFTER, FEEDBACK_WITHIN)) {
      const [due]: [DueRow[], number] = await this.tenant.withTenant(orgId, (m) =>
        m.query(
          `UPDATE registrations r SET feedback_requested_at = now()
           FROM events e, clubs c, users u
           WHERE r.id IN (
                   SELECT r2.id FROM registrations r2 JOIN events e2 ON e2.id = r2.event_id
                   WHERE e2.status = 'published'
                     AND e2.ends_at <= now() - $1::interval AND e2.ends_at > now() - $2::interval
                     AND r2.checked_in_at IS NOT NULL AND r2.cancelled_at IS NULL AND r2.feedback_requested_at IS NULL
                   LIMIT ${BATCH}
                   FOR UPDATE OF r2 SKIP LOCKED)
             AND e.id = r.event_id AND c.id = e.club_id AND u.id = r.user_id
           RETURNING r.id AS registration_id, e.id AS event_id, e.title AS event_title, c.name AS club_name,
                     u.email, u.name`,
          [FEEDBACK_AFTER, FEEDBACK_WITHIN],
        ),
      );
      for (const row of due) {
        if (sent > 0 && this.paceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
        try {
          await this.email.sendFeedbackRequest(
            row.email,
            { name: row.name, eventTitle: row.event_title, clubName: row.club_name, url: this.link(row.registration_id, row.event_id) },
            `feedback-${row.registration_id}`,
          );
          sent++;
        } catch (error) {
          // asked once means once: a failed send isn't retried into a second ask
          this.logger.error(`Feedback request ${row.registration_id} failed`, error instanceof Error ? error.stack : error);
        }
      }
    }
    if (sent > 0) this.logger.log(`Asked ${sent} ${sent === 1 ? 'person' : 'people'} how it was`);
    return sent;
  }

  /** The form behind a link: which event, and their answer so far. */
  form(token: string): Promise<FeedbackFormDto> {
    return this.withPlace(token, async (m, place) => {
      const [answer]: { rating: number; comment: string | null }[] = await m.query(
        `SELECT rating, comment FROM event_feedback WHERE registration_id = $1`,
        [place.registrationId],
      );
      return {
        eventTitle: place.title,
        clubName: place.clubName,
        endedAt: place.endsAt,
        rating: answer?.rating ?? null,
        comment: answer?.comment ?? null,
      };
    });
  }

  /** Records (or changes) their answer. */
  give(token: string, { rating, comment }: GiveFeedbackDto): Promise<FeedbackFormDto> {
    return this.withPlace(token, async (m, place, orgId) => {
      if (place.endsAt.getTime() < Date.now() - OPEN_FOR_DAYS * 86_400_000) {
        throw HttpError.conflict('Feedback for this event has closed', 'FEEDBACK_CLOSED');
      }
      const text = comment?.trim() || null;
      await m.query(
        `INSERT INTO event_feedback (org_id, event_id, registration_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (registration_id) DO UPDATE SET rating = $4, comment = $5, updated_at = now()`,
        [orgId, place.eventId, place.registrationId, rating, text],
      );
      return { eventTitle: place.title, clubName: place.clubName, endedAt: place.endsAt, rating, comment: text };
    });
  }

  /** What people thought of an event, without names (analytics.view). */
  async summary(access: ClubAccess, eventId: string): Promise<FeedbackSummaryDto> {
    const orgId = await this.tenant.orgIdForClub(access.clubId);
    if (!orgId) throw eventNotFound();
    return this.tenant.withTenant(orgId, async (m) => {
      const [event]: unknown[] = await m.query(`SELECT 1 FROM events WHERE id = $1 AND club_id = $2 AND status <> 'draft'`, [
        eventId,
        access.clubId,
      ]);
      if (!event) throw eventNotFound();
      const answers: { rating: number; comment: string | null; updated_at: Date }[] = await m.query(
        `SELECT rating, comment, updated_at FROM event_feedback WHERE event_id = $1 ORDER BY updated_at DESC`,
        [eventId],
      );
      const [{ asked }]: { asked: number }[] = await m.query(
        `SELECT count(*)::int AS asked FROM registrations WHERE event_id = $1 AND feedback_requested_at IS NOT NULL AND checked_in_at IS NOT NULL`,
        [eventId],
      );
      const ratings = [1, 2, 3, 4, 5].map((n) => answers.filter((a) => a.rating === n).length);
      const total = answers.reduce((sum, a) => sum + a.rating, 0);
      return {
        count: answers.length,
        average: answers.length ? Math.round((total / answers.length) * 10) / 10 : null,
        ratings,
        asked,
        comments: answers
          .filter((a): a is typeof a & { comment: string } => !!a.comment)
          .map((a) => ({ rating: a.rating, comment: a.comment, at: a.updated_at })),
      };
    });
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.requestDue();
    } catch (error) {
      this.logger.error('Feedback round failed', error instanceof Error ? error.stack : error);
    } finally {
      this.running = false;
    }
  }

  // the place a link stands for: someone who came in to an event that's over
  private async withPlace<T>(
    token: string,
    work: (
      m: EntityManager,
      place: { registrationId: string; eventId: string; title: string; clubName: string; endsAt: Date },
      orgId: string,
    ) => Promise<T>,
  ): Promise<T> {
    const ids = this.read(token);
    if (!ids) throw notFound();
    const orgId = await this.tenant.orgIdForEvent(ids.eventId);
    if (!orgId) throw notFound();
    return this.tenant.withTenant(orgId, async (m) => {
      const [row]: { title: string; club_name: string; ends_at: Date }[] = await m.query(
        `SELECT e.title, c.name AS club_name, e.ends_at
         FROM registrations r JOIN events e ON e.id = r.event_id JOIN clubs c ON c.id = e.club_id
         WHERE r.id = $1 AND r.event_id = $2 AND r.checked_in_at IS NOT NULL AND e.ends_at <= now()`,
        [ids.registrationId, ids.eventId],
      );
      if (!row) throw notFound();
      return work(m, { ...ids, title: row.title, clubName: row.club_name, endsAt: row.ends_at }, orgId);
    });
  }

  // "<registration>.<event>.<mac>", ids in base64url
  private link(registrationId: string, eventId: string): string {
    const id = (uuid: string) => Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
    const url = new URL('/feedback', config.appUrl);
    url.searchParams.set('token', `${id(registrationId)}.${id(eventId)}.${this.mac(registrationId, eventId)}`);
    return url.toString();
  }

  private mac(registrationId: string, eventId: string): string {
    return createHmac('sha256', config.ticket.secret)
      .update(`feedback:${registrationId}:${eventId}`)
      .digest()
      .subarray(0, 18)
      .toString('base64url');
  }

  private read(token: string): { registrationId: string; eventId: string } | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const [reg, evt, mac] = token.split('.');
    if (!reg || !evt || !mac) return null;
    const uuid = (part: string) => {
      const hex = Buffer.from(part, 'base64url').toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    const registrationId = uuid(reg);
    const eventId = uuid(evt);
    if (!isUUID(registrationId) || !isUUID(eventId)) return null;
    const expected = Buffer.from(this.mac(registrationId, eventId));
    const given = Buffer.from(mac);
    return expected.length === given.length && timingSafeEqual(expected, given) ? { registrationId, eventId } : null;
  }
}
