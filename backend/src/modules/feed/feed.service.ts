import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { buildCalendar } from '../../common/utils/ics.js';
import { config } from '../../config/config.js';
import { TenantService } from '../../database/tenant.service.js';

const feedNotFound = () => HttpError.notFound('No such calendar feed', 'FEED_NOT_FOUND');

/**
 * Calendar feeds: a club's events as a calendar people subscribe to once,
 * then see every new, moved or cancelled event without doing anything.
 * Calendar apps can't sign in, so the link carries its own proof: the
 * user's id and an HMAC of it (with the feed version), under a key used for
 * nothing else. Nothing to store, and resetting the version turns every old
 * link off. Each request still checks they're in the club today.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly data: DataSource,
    private readonly tenant: TenantService,
  ) {}

  /** The secret part of your feed links. */
  async token(userId: string): Promise<string> {
    return this.sign(userId, await this.version(userId));
  }

  /** A new secret: every link made with the old one stops working. */
  async reset(userId: string): Promise<string> {
    const [[row]]: [{ calendar_feed_version: number }[], number] = await this.data.query(
      `UPDATE users SET calendar_feed_version = calendar_feed_version + 1 WHERE id = $1 RETURNING calendar_feed_version`,
      [userId],
    );
    return this.sign(userId, row.calendar_feed_version);
  }

  /** A club's published (and cancelled) events, recent and upcoming, for a member of it. */
  async clubFeed(token: string, clubId: string): Promise<string> {
    const userId = await this.verify(token);
    if (!userId || !isUUID(clubId)) throw feedNotFound();
    const orgId = await this.tenant.orgIdForClub(clubId);
    if (!orgId) throw feedNotFound();

    return this.tenant.withTenant(orgId, async (m) => {
      // still in the club: leaving it ends the feed (as not found: the link says nothing either way)
      const [club]: { name: string; org_name: string; slug: string }[] = await m.query(
        `SELECT c.name, o.name AS org_name, o.slug
         FROM club_members cm JOIN clubs c ON c.id = cm.club_id JOIN organisations o ON o.id = c.org_id
         WHERE cm.club_id = $1 AND cm.user_id = $2`,
        [clubId, userId],
      );
      if (!club) throw feedNotFound();
      const events: {
        id: string;
        title: string;
        description: string | null;
        location: string | null;
        starts_at: Date;
        ends_at: Date;
        status: string;
        updated_at: Date;
      }[] = await m.query(
        `SELECT id, title, description, location, starts_at, ends_at, status, updated_at
         FROM events
         WHERE club_id = $1 AND status IN ('published', 'cancelled') AND ends_at > now() - interval '90 days'
         ORDER BY starts_at`,
        [clubId],
      );
      return buildCalendar(
        events.map((e) => {
          const url = new URL(`/o/${club.slug}`, config.appUrl);
          url.searchParams.set('club', clubId);
          url.searchParams.set('event', e.id);
          return {
            eventId: e.id,
            title: e.title,
            startsAt: e.starts_at,
            endsAt: e.ends_at,
            location: e.location,
            description: [e.description, url.toString()].filter(Boolean).join('\n\n'),
            url: url.toString(),
            updatedAt: e.updated_at,
            cancelled: e.status === 'cancelled',
          };
        }),
        { name: `${club.name}, ${club.org_name}` },
      );
    });
  }

  private async version(userId: string): Promise<number> {
    const [row]: { calendar_feed_version: number }[] = await this.data.query(
      `SELECT calendar_feed_version FROM users WHERE id = $1`,
      [userId],
    );
    if (!row) throw feedNotFound();
    return row.calendar_feed_version;
  }

  // "<user id, base64url>.<mac>": the id is plain (it's in the link anyway), the mac proves it
  private sign(userId: string, version: number): string {
    const id = Buffer.from(userId.replace(/-/g, ''), 'hex').toString('base64url');
    return `${id}.${this.mac(userId, version)}`;
  }

  private mac(userId: string, version: number): string {
    return createHmac('sha256', config.ticket.secret)
      .update(`calendar-feed:${userId}:${version}`)
      .digest()
      .subarray(0, 18)
      .toString('base64url');
  }

  private async verify(token: string): Promise<string | null> {
    const [id, mac] = typeof token === 'string' && token.length < 100 ? token.split('.') : [];
    if (!id || !mac) return null;
    const hex = Buffer.from(id, 'base64url').toString('hex');
    if (hex.length !== 32) return null;
    const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const [row]: { calendar_feed_version: number }[] = await this.data.query(
      `SELECT calendar_feed_version FROM users WHERE id = $1`,
      [userId],
    );
    if (!row) return null;
    const expected = Buffer.from(this.mac(userId, row.calendar_feed_version));
    const given = Buffer.from(mac);
    return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
  }
}
