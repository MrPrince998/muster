import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthUser } from '../../common/types/auth-user.js';
import { TenantService } from '../../database/tenant.service.js';
import type { EventStatus } from '../event/entities/event.entity.js';
import { Permission } from '../permission/permissions.js';
import type { ClubHit, EventHit, PersonHit, SearchResultDto, WorkspaceHit } from './dto/search.dto.js';

const LIMIT = { workspaces: 4, clubs: 5, events: 8, people: 5 };

/**
 * How well `column` matches the query, 0 to 1: the whole name starting with
 * it, then a word starting with it, then containing it, then trigram word
 * similarity, which forgives typos ("robtics"). $1 is the raw query, $2
 * "q%", $3 "% q%", $4 "%q%" (LIKE-escaped).
 */
const score = (column: string) => `GREATEST(
  word_similarity($1, ${column}),
  CASE WHEN ${column} ILIKE $2 THEN 1 WHEN ${column} ILIKE $3 THEN 0.9 WHEN ${column} ILIKE $4 THEN 0.7 ELSE 0 END
)`;
// matches at all: contains it, or close enough to forgive a typo (<% uses the trigram index)
const matches = (column: string) => `(${column} ILIKE $4 OR $1 <% ${column})`;

type Scored<T> = T & { score: number };

/**
 * The ⌘K box, across every workspace you belong to. Each workspace is
 * searched inside its own tenant transaction, so row-level security limits
 * what can come back exactly as it does everywhere else; within that, only
 * what you could open: your clubs, their events (drafts only if you could edit
 * them), and the members of your workspaces (whom the Members page shows too).
 */
@Injectable()
export class SearchService {
  constructor(private readonly tenant: TenantService) {}

  async search(user: AuthUser, q: string): Promise<SearchResultDto> {
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    const params = [q, `${escaped}%`, `% ${escaped}%`, `%${escaped}%`];
    const memberships = await this.tenant.userOrganisations(user.id);

    const perWorkspace = await Promise.all(
      memberships.map((org) =>
        this.tenant.withTenant(org.orgId, async (m) => {
          const ref = { orgName: org.name, orgSlug: org.slug };
          const zone = { timeZone: org.timeZone };
          // forgive one typo in a short word ("robtics" scores 0.55); this
          // transaction only, and results are ranked and capped anyway
          await m.query(`SELECT set_config('pg_trgm.word_similarity_threshold', '0.5', true)`);
          // one after another: they share the transaction's connection
          const workspace = await this.workspace(m, params, org.orgId);
          const clubs = await this.clubs(m, params, user.id);
          const events = await this.events(m, params, user.id);
          const people = await this.people(m, params);
          return {
            workspaces: workspace === null ? [] : [{ orgId: org.orgId, name: org.name, slug: org.slug, role: org.role, score: workspace }],
            clubs: clubs.map((c) => ({ ...c, ...ref })),
            events: events.map((e) => ({ ...e, ...ref, ...zone })),
            people: people.map((p) => ({ ...p, ...ref })),
          };
        }),
      ),
    );

    const all = <K extends keyof typeof LIMIT>(kind: K) => perWorkspace.flatMap((w) => w[kind] as Scored<object>[]);
    const best = <T>(hits: Scored<T>[], limit: number, tieBreak?: (a: T, b: T) => number): T[] =>
      hits
        .sort((a, b) => b.score - a.score || (tieBreak?.(a, b) ?? 0))
        .slice(0, limit)
        .map(({ score: _score, ...hit }) => hit as T);

    return {
      workspaces: best(all('workspaces') as Scored<WorkspaceHit>[], LIMIT.workspaces),
      clubs: best(all('clubs') as Scored<ClubHit>[], LIMIT.clubs),
      // equally good matches: what's coming up before what's over, soonest first
      events: best(all('events') as Scored<EventHit>[], LIMIT.events, (a, b) => {
        if (a.ended !== b.ended) return a.ended ? 1 : -1;
        return a.ended ? b.startsAt.getTime() - a.startsAt.getTime() : a.startsAt.getTime() - b.startsAt.getTime();
      }),
      people: best(all('people') as Scored<PersonHit>[], LIMIT.people),
    };
  }

  // this workspace's own name, scored; null when it doesn't match
  private async workspace(m: EntityManager, params: string[], orgId: string): Promise<number | null> {
    const rows: { score: number }[] = await m.query(
      `SELECT ${score('o.name')} AS score FROM organisations o WHERE o.id = $5 AND ${matches('o.name')}`,
      [...params, orgId],
    );
    return rows[0] ? Number(rows[0].score) : null;
  }

  // clubs you're a member of
  private async clubs(m: EntityManager, params: string[], userId: string): Promise<Scored<Omit<ClubHit, 'orgName' | 'orgSlug'>>[]> {
    const rows: { id: string; name: string; score: number }[] = await m.query(
      `SELECT c.id, c.name, ${score('c.name')} AS score
       FROM clubs c JOIN club_members cm ON cm.club_id = c.id AND cm.user_id = $5
       WHERE ${matches('c.name')}
       ORDER BY score DESC LIMIT ${LIMIT.clubs}`,
      [...params, userId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, score: Number(r.score) }));
  }

  // events of your clubs; drafts only where you could edit them (as the event list decides)
  private async events(
    m: EntityManager,
    params: string[],
    userId: string,
  ): Promise<Scored<Omit<EventHit, 'orgName' | 'orgSlug' | 'timeZone'>>[]> {
    const rows: {
      id: string;
      title: string;
      starts_at: Date;
      ends_at: Date;
      status: EventStatus;
      ended: boolean;
      club_id: string;
      club_name: string;
      score: number;
    }[] = await m.query(
      `WITH mine AS (
         SELECT cm.club_id,
                COALESCE(bool_or(r.is_owner), false) AS is_owner,
                COALESCE(array_agg(DISTINCT p.permission) FILTER (WHERE p.permission IS NOT NULL), '{}') AS permissions
         FROM club_members cm
         LEFT JOIN member_roles mr ON mr.club_id = cm.club_id AND mr.user_id = cm.user_id
         LEFT JOIN roles r ON r.id = mr.role_id
         LEFT JOIN LATERAL unnest(r.permissions) AS p(permission) ON true
         WHERE cm.user_id = $5
         GROUP BY cm.club_id
       )
       SELECT e.id, e.title, e.starts_at, e.ends_at, e.status, e.ends_at <= now() AS ended, c.id AS club_id, c.name AS club_name,
              ${score('e.title')} AS score
       FROM events e
       JOIN mine ON mine.club_id = e.club_id
       JOIN clubs c ON c.id = e.club_id
       WHERE ${matches('e.title')}
         AND (e.status <> 'draft'
              OR mine.is_owner
              OR '${Permission.EventManageAny}' = ANY(mine.permissions)
              OR ('${Permission.EventManageOwn}' = ANY(mine.permissions) AND e.created_by = $5))
       ORDER BY score DESC, e.starts_at DESC
       LIMIT ${LIMIT.events}`,
      [...params, userId],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      ended: r.ended,
      clubId: r.club_id,
      clubName: r.club_name,
      score: Number(r.score),
    }));
  }

  // members of this workspace, by name (users is global; org_members, under RLS, limits it)
  private async people(m: EntityManager, params: string[]): Promise<Scored<Omit<PersonHit, 'orgName' | 'orgSlug'>>[]> {
    const rows: { user_id: string; name: string; role: string; score: number }[] = await m.query(
      `SELECT u.id AS user_id, u.name, om.role, ${score('u.name')} AS score
       FROM org_members om JOIN users u ON u.id = om.user_id
       WHERE ${matches('u.name')}
       ORDER BY score DESC LIMIT ${LIMIT.people}`,
      params,
    );
    return rows.map((r) => ({ userId: r.user_id, name: r.name, role: r.role, score: Number(r.score) }));
  }
}
