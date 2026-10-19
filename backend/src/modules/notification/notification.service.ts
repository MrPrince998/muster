import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';
import { BULK_PACE_MS, EmailService } from '../email/email.service.js';
import { formatWhen } from '../email/format-when.js';
import type { ClubAccess } from '../permission/club-access.js';

export const EVENT_EMAILS = ['off', 'instant', 'weekly'] as const;
export type EventEmails = (typeof EVENT_EMAILS)[number];

// the announcement sweep is quick (people expect "new event" mail soon); the digest's slow
const ANNOUNCE_EVERY_MS = 2 * 60_000;
const DIGEST_EVERY_MS = 15 * 60_000;
const BATCH = 200;

const REPEATS: Record<string, string> = { week: 'week', fortnight: 'fortnight', month: 'month' };

interface AnnouncedRow {
  id: string;
  club_id: string;
  created_by: string | null;
  title: string;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  series_id: string | null;
  repeat_every: string | null;
}

const badLink = () => HttpError.badRequest('This link is wrong or incomplete', 'INVALID_TOKEN');

/**
 * New-event emails, as each member chooses per club: none (the default), one
 * as each event is published, or Monday's digest of the next two weeks.
 *
 * Both run as sweeps inside the API, claiming before sending (like
 * reminders), so each event is announced once and each person gets one
 * digest a week, however many copies of the API run. A series is announced
 * once, as a series. Every email carries a link that turns it off with no
 * sign-in: an HMAC of who and which club (or workspace, for the digest).
 */
@Injectable()
export class NotificationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = { announce: false, digest: false };

  constructor(
    private readonly tenant: TenantService,
    private readonly email: EmailService,
    @Inject(BULK_PACE_MS) private readonly paceMs: number,
  ) {}

  onApplicationBootstrap(): void {
    // tests run them by hand; timers would race them
    if (!config.reminders.enabled || process.env.VITEST) return;
    const every = (ms: number, job: 'announce' | 'digest') => {
      const timer = setInterval(() => void this.tick(job), ms);
      timer.unref();
      this.timers.push(timer);
    };
    every(ANNOUNCE_EVERY_MS, 'announce');
    every(DIGEST_EVERY_MS, 'digest');
  }

  onModuleDestroy(): void {
    this.timers.forEach(clearInterval);
  }

  // --- preferences -------------------------------------------------------------------

  /** What you get from this club. */
  preference(access: ClubAccess): Promise<EventEmails> {
    return this.inClub(access.clubId, async (m) => {
      const [row]: { event_emails: EventEmails }[] = await m.query(
        `SELECT event_emails FROM club_members WHERE club_id = $1 AND user_id = $2`,
        [access.clubId, access.userId],
      );
      if (!row) throw HttpError.forbidden('Not a member of this club', 'NOT_A_MEMBER');
      return row.event_emails;
    });
  }

  setPreference(access: ClubAccess, value: EventEmails): Promise<EventEmails> {
    return this.inClub(access.clubId, async (m) => {
      const [rows]: [unknown[], number] = await m.query(
        `UPDATE club_members SET event_emails = $3 WHERE club_id = $1 AND user_id = $2 RETURNING 1`,
        [access.clubId, access.userId, value],
      );
      if (rows.length === 0) throw HttpError.forbidden('Not a member of this club', 'NOT_A_MEMBER');
      return value;
    });
  }

  /**
   * "Stop these emails", from the link in one: a club's new-event emails, or
   * (from a digest) every weekly digest in that workspace. Says what stopped.
   */
  async optOut(token: string): Promise<{ stopped: string }> {
    const parsed = this.readOptOut(token);
    if (!parsed) throw badLink();
    const { kind, userId, scopeId } = parsed;
    const orgId = kind === 'c' ? await this.tenant.orgIdForClub(scopeId) : scopeId;
    if (!orgId) throw badLink();
    return this.tenant.withTenant(orgId, async (m) => {
      if (kind === 'c') {
        await m.query(`UPDATE club_members SET event_emails = 'off' WHERE club_id = $1 AND user_id = $2`, [scopeId, userId]);
        const [club]: { name: string }[] = await m.query(`SELECT name FROM clubs WHERE id = $1`, [scopeId]);
        return { stopped: `New-event emails from ${club?.name ?? 'this club'}` };
      }
      await m.query(
        `UPDATE club_members SET event_emails = 'off' WHERE org_id = $1 AND user_id = $2 AND event_emails = 'weekly'`,
        [scopeId, userId],
      );
      const [org]: { name: string }[] = await m.query(`SELECT name FROM organisations WHERE id = $1`, [scopeId]);
      return { stopped: `The weekly digest from ${org?.name ?? 'this workspace'}` };
    });
  }

  // --- announcements -----------------------------------------------------------------

  /** One round: announces every newly published event. Returns how many emails went out. */
  async announce(): Promise<number> {
    let sent = 0;
    for (const orgId of await this.tenant.dueAnnouncementOrganisations()) {
      const { events, org } = await this.tenant.withTenant(orgId, async (m) => {
        const [events]: [AnnouncedRow[], number] = await m.query(
          `UPDATE events e SET announced_at = now()
           WHERE e.id IN (SELECT id FROM events WHERE status = 'published' AND announced_at IS NULL
                          ORDER BY published_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
           RETURNING e.id, e.club_id, e.created_by, e.title, e.starts_at, e.ends_at, e.location,
                     e.series_id, e.repeat_every`,
        );
        const [org]: { slug: string; time_zone: string }[] = await m.query(
          `SELECT slug, time_zone FROM organisations WHERE id = $1`,
          [orgId],
        );
        return { events, org };
      });

      // a series is one piece of news: its first occurrence still to come, and how many
      const groups = new Map<string, AnnouncedRow[]>();
      for (const event of events.filter((e) => e.starts_at > new Date())) {
        const key = event.series_id ?? event.id;
        groups.set(key, [...(groups.get(key) ?? []), event]);
      }
      for (const group of groups.values()) {
        const first = group.reduce((a, b) => (a.starts_at <= b.starts_at ? a : b));
        const { club, people } = await this.tenant.withTenant(orgId, async (m) => {
          const [club]: { name: string }[] = await m.query(`SELECT name FROM clubs WHERE id = $1`, [first.club_id]);
          // whoever made it knows already
          const people: { id: string; email: string; name: string }[] = await m.query(
            `SELECT u.id, u.email, u.name FROM club_members cm JOIN users u ON u.id = cm.user_id
             WHERE cm.club_id = $1 AND cm.event_emails = 'instant' AND cm.user_id IS DISTINCT FROM $2`,
            [first.club_id, first.created_by],
          );
          return { club, people };
        });
        const url = new URL(`/o/${org.slug}`, config.appUrl);
        url.searchParams.set('club', first.club_id);
        url.searchParams.set('event', first.id);
        for (const person of people) {
          if (sent > 0 && this.paceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
          try {
            await this.email.sendNewEvent(
              person.email,
              {
                name: person.name,
                clubName: club.name,
                eventTitle: first.title,
                when: formatWhen(first.starts_at, first.ends_at, org.time_zone),
                where: first.location,
                repeats:
                  first.repeat_every && group.length > 1
                    ? `Every ${REPEATS[first.repeat_every]}, ${group.length} times`
                    : undefined,
                url: url.toString(),
                stopUrl: this.stopUrl('c', person.id, first.club_id),
              },
              `new-event-${first.series_id ?? first.id}-${person.id}`,
            );
            sent++;
          } catch (error) {
            // announced either way: a retry would mail everyone else twice
            this.logger.error(`New-event email to ${person.id} failed`, error instanceof Error ? error.stack : error);
          }
        }
      }
    }
    if (sent > 0) this.logger.log(`Sent ${sent} new-event email${sent === 1 ? '' : 's'}`);
    return sent;
  }

  // --- the weekly digest -------------------------------------------------------------

  /**
   * One round: Monday's digest for every workspace where it's Monday morning
   * (any day, with `anyDay`: for tests). Returns how many went out.
   */
  async sendDigests({ anyDay = false } = {}): Promise<number> {
    let sent = 0;
    for (const orgId of await this.tenant.dueDigestOrganisations(anyDay)) {
      const { org, digests } = await this.tenant.withTenant(orgId, async (m) => {
        const [org]: { name: string; slug: string; time_zone: string }[] = await m.query(
          `SELECT name, slug, time_zone FROM organisations WHERE id = $1`,
          [orgId],
        );
        const [people]: [{ user_id: string }[], number] = await m.query(
          `UPDATE org_members om SET digest_sent_at = now()
           WHERE om.org_id = $1 AND om.user_id IN (
             SELECT om2.user_id FROM org_members om2
             WHERE om2.org_id = $1
               AND (om2.digest_sent_at IS NULL OR om2.digest_sent_at < now() - interval '6 days')
               AND EXISTS (SELECT 1 FROM club_members cm
                           WHERE cm.org_id = om2.org_id AND cm.user_id = om2.user_id AND cm.event_emails = 'weekly')
             LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
           RETURNING om.user_id`,
          [orgId],
        );
        const digests = [];
        for (const { user_id } of people) {
          const [user]: { email: string; name: string }[] = await m.query(
            `SELECT email, name FROM users WHERE id = $1`,
            [user_id],
          );
          const events: { title: string; starts_at: Date; club_name: string; published_at: Date }[] = await m.query(
            `SELECT e.title, e.starts_at, c.name AS club_name, e.published_at
             FROM events e
             JOIN club_members cm ON cm.club_id = e.club_id AND cm.user_id = $1 AND cm.event_emails = 'weekly'
             JOIN clubs c ON c.id = e.club_id
             WHERE e.status = 'published' AND e.starts_at > now() AND e.starts_at < now() + interval '14 days'
             ORDER BY e.starts_at`,
            [user_id],
          );
          digests.push({ userId: user_id, ...user, events });
        }
        return { org, digests };
      });

      const weekAgo = Date.now() - 7 * 86_400_000;
      for (const digest of digests) {
        // nothing coming up: no email (still counts as this week's)
        if (digest.events.length === 0) continue;
        if (sent > 0 && this.paceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
        try {
          await this.email.sendDigest(
            digest.email,
            {
              name: digest.name,
              workspaceName: org.name,
              events: digest.events.map((e) => ({
                line: `${shortWhen(e.starts_at, org.time_zone)}: ${e.title} (${e.club_name})`,
                isNew: e.published_at.getTime() > weekAgo,
              })),
              url: new URL(`/o/${org.slug}`, config.appUrl).toString(),
              stopUrl: this.stopUrl('o', digest.userId, orgId),
            },
            `digest-${orgId}-${digest.userId}-${new Date().toISOString().slice(0, 10)}`,
          );
          sent++;
        } catch (error) {
          this.logger.error(`Digest to ${digest.userId} failed`, error instanceof Error ? error.stack : error);
        }
      }
    }
    if (sent > 0) this.logger.log(`Sent ${sent} weekly digest${sent === 1 ? '' : 's'}`);
    return sent;
  }

  // --- helpers -----------------------------------------------------------------------

  private async tick(job: 'announce' | 'digest'): Promise<void> {
    if (this.running[job]) return;
    this.running[job] = true;
    try {
      await (job === 'announce' ? this.announce() : this.sendDigests());
    } catch (error) {
      this.logger.error(`${job} round failed`, error instanceof Error ? error.stack : error);
    } finally {
      this.running[job] = false;
    }
  }

  private async inClub<T>(clubId: string, work: (m: EntityManager) => Promise<T>): Promise<T> {
    const orgId = await this.tenant.orgIdForClub(clubId);
    if (!orgId) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
    return this.tenant.withTenant(orgId, work);
  }

  // "c.<user>.<club>.<mac>" or "o.<user>.<workspace>.<mac>", ids in base64url
  private stopUrl(kind: 'c' | 'o', userId: string, scopeId: string): string {
    const id = (uuid: string) => Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
    const token = `${kind}.${id(userId)}.${id(scopeId)}.${this.mac(kind, userId, scopeId)}`;
    const url = new URL('/unsubscribe', config.appUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private mac(kind: string, userId: string, scopeId: string): string {
    return createHmac('sha256', config.ticket.secret)
      .update(`email-opt-out:${kind}:${userId}:${scopeId}`)
      .digest()
      .subarray(0, 18)
      .toString('base64url');
  }

  private readOptOut(token: string): { kind: 'c' | 'o'; userId: string; scopeId: string } | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const [kind, user, scope, mac] = token.split('.');
    if ((kind !== 'c' && kind !== 'o') || !user || !scope || !mac) return null;
    const uuid = (part: string) => {
      const hex = Buffer.from(part, 'base64url').toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    const userId = uuid(user);
    const scopeId = uuid(scope);
    if (!isUUID(userId) || !isUUID(scopeId)) return null;
    const expected = Buffer.from(this.mac(kind, userId, scopeId));
    const given = Buffer.from(mac);
    return expected.length === given.length && timingSafeEqual(expected, given) ? { kind, userId, scopeId } : null;
  }
}

// "Thu 24 Oct, 18:30" on the workspace's clock
function shortWhen(at: Date, zone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day.format(at)}, ${time.format(at)}`;
}
