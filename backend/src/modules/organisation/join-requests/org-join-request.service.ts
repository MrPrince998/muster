import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../../common/errors/http-error.js';
import { cursorAt, decodeTimeCursor, encodeTimeCursor } from '../../../common/utils/time-cursor.js';
import { isUniqueViolation } from '../../../common/utils/pg-errors.js';
import { TenantService } from '../../../database/tenant.service.js';
import { EmailService } from '../../email/email.service.js';
import { OrgJoinRequestStatus } from '../entities/org-join-request.entity.js';
import type { OrgMembership } from '../org-roles.js';
import type { JoinRequestsPageDto, MyJoinRequestDto } from './dto/join-request.dto.js';
import { audit, AuditAction } from '../../audit/audit.js';

// after a rejection, the same person must wait before asking again
export const REJECTION_COOLDOWN_HOURS = 24;

const requestNotFound = () =>
  HttpError.notFound('No pending join request with that id', 'JOIN_REQUEST_NOT_FOUND');

/**
 * Discord-style "apply to join" for workspaces whose join policy is
 * "request". Every method runs inside withTenant(): requests are tenant data.
 */
@Injectable()
export class OrgJoinRequestService {
  constructor(
    private readonly tenant: TenantService,
    private readonly email: EmailService,
  ) {}

  /**
   * Files a request. Call inside the workspace's withTenant() transaction,
   * after checking the user is not already a member.
   */
  async create(m: EntityManager, orgId: string, userId: string, message?: string): Promise<MyJoinRequestDto> {
    const [recent]: { decided_at: Date }[] = await m.query(
      `SELECT decided_at FROM org_join_requests
       WHERE org_id = $1 AND user_id = $2 AND status = 'rejected'
         AND decided_at > now() - make_interval(hours => $3)
       ORDER BY decided_at DESC LIMIT 1`,
      [orgId, userId, REJECTION_COOLDOWN_HOURS],
    );
    if (recent) {
      const retryAfter = new Date(recent.decided_at.getTime() + REJECTION_COOLDOWN_HOURS * 3_600_000);
      throw HttpError.conflict('Your last request was declined; try again later', 'REQUEST_RECENTLY_REJECTED', {
        retryAfter,
      });
    }

    try {
      const [row]: { id: string; status: OrgJoinRequestStatus; created_at: Date }[] = await m.query(
        `INSERT INTO org_join_requests (org_id, user_id, message)
         VALUES ($1, $2, $3) RETURNING id, status, created_at`,
        [orgId, userId, message?.trim() || null],
      );
      return { id: row.id, status: row.status, createdAt: row.created_at };
    } catch (error) {
      // the partial unique index allows one pending request per person
      if (isUniqueViolation(error, 'org_join_requests_one_pending')) {
        throw HttpError.conflict('You already have a pending request', 'REQUEST_PENDING');
      }
      throw error;
    }
  }

  async findPending(m: EntityManager, orgId: string, userId: string): Promise<MyJoinRequestDto | null> {
    const [row]: { id: string; status: OrgJoinRequestStatus; created_at: Date }[] = await m.query(
      `SELECT id, status, created_at FROM org_join_requests
       WHERE org_id = $1 AND user_id = $2 AND status = 'pending'`,
      [orgId, userId],
    );
    return row ? { id: row.id, status: row.status, createdAt: row.created_at } : null;
  }

  /** Withdraws the user's own pending request. */
  async cancel(m: EntityManager, orgId: string, userId: string): Promise<void> {
    const [rows]: [unknown[], number] = await m.query(
      `UPDATE org_join_requests SET status = 'cancelled', decided_at = now(), updated_at = now()
       WHERE org_id = $1 AND user_id = $2 AND status = 'pending' RETURNING 1`,
      [orgId, userId],
    );
    if (rows.length === 0) throw requestNotFound();
  }

  /**
   * The moderators' queue, a page at a time: pending ones oldest first (who's
   * waited longest), decided ones newest first. `after` is the `next` of the
   * page before (keyset on asked, then id).
   */
  list(
    me: OrgMembership,
    query: { status?: OrgJoinRequestStatus; after?: string; limit?: number } = {},
  ): Promise<JoinRequestsPageDto> {
    const status = query.status ?? OrgJoinRequestStatus.Pending;
    const limit = query.limit ?? 50;
    const cursor = query.after ? decodeTimeCursor(query.after) : null;
    if (query.after && !cursor) throw HttpError.badRequest('A wrong page cursor', 'INVALID_CURSOR');
    const oldestFirst = status === OrgJoinRequestStatus.Pending;
    return this.tenant.withTenant(me.orgId, async (m) => {
      const rows: {
        id: string;
        user_id: string;
        name: string;
        email: string;
        message: string | null;
        status: OrgJoinRequestStatus;
        created_at: Date;
        cursor_at: string;
        decided_at: Date | null;
        decided_by: string | null;
      }[] = await m.query(
        `SELECT r.id, r.user_id, u.name, u.email, r.message, r.status, r.created_at, ${cursorAt('r.created_at')} AS cursor_at,
                r.decided_at, r.decided_by
         FROM org_join_requests r
         JOIN users u ON u.id = r.user_id
         WHERE r.org_id = $1 AND r.status = $2
           AND ($3::timestamptz IS NULL OR (r.created_at, r.id) ${oldestFirst ? '>' : '<'} ($3, $4::uuid))
         ORDER BY r.created_at ${oldestFirst ? 'ASC' : 'DESC'}, r.id ${oldestFirst ? 'ASC' : 'DESC'}
         LIMIT $5`,
        [me.orgId, status, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
      );
      const [{ total }]: { total: number }[] = await m.query(
        `SELECT count(*)::int AS total FROM org_join_requests WHERE org_id = $1 AND status = $2`,
        [me.orgId, status],
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        requests: page.map((r) => ({
          id: r.id,
          userId: r.user_id,
          name: r.name,
          email: r.email,
          message: r.message,
          status: r.status,
          createdAt: r.created_at,
          decidedAt: r.decided_at,
          decidedBy: r.decided_by,
        })),
        next: rows.length > limit ? encodeTimeCursor(last.cursor_at, last.id) : null,
        total,
      };
    });
  }

  /**
   * Approves a pending request: the person becomes a member of the workspace
   * and its default club. The status change is a conditional UPDATE, so two
   * moderators clicking at once approve it exactly once. They are emailed
   * once the transaction has committed, never for a change that rolled back.
   */
  async approve(me: OrgMembership, requestId: string): Promise<void> {
    const decided = await this.tenant.withTenant(me.orgId, async (m) => {
      const result = await this.decide(m, me, requestId, OrgJoinRequestStatus.Approved);
      // they may have joined another way (an invite link) while waiting
      await m.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [me.orgId, result.userId],
      );
      await m.query(
        `INSERT INTO club_members (club_id, user_id, org_id)
         SELECT id, $2, $1 FROM clubs WHERE org_id = $1 AND is_default
         ON CONFLICT DO NOTHING`,
        [me.orgId, result.userId],
      );
      await audit(m, { actorId: me.userId, action: AuditAction.OrgJoinApproved, subjectUserId: result.userId });
      return result;
    });

    this.email.inBackground(
      'join request approved',
      this.email.sendJoinRequestApproved({
        to: decided.email,
        name: decided.name,
        orgName: decided.orgName,
        orgSlug: decided.orgSlug,
        requestId,
      }),
    );
  }

  async reject(me: OrgMembership, requestId: string): Promise<void> {
    const decided = await this.tenant.withTenant(me.orgId, async (m) => {
      const result = await this.decide(m, me, requestId, OrgJoinRequestStatus.Rejected);
      await audit(m, { actorId: me.userId, action: AuditAction.OrgJoinRejected, subjectUserId: result.userId });
      return result;
    });

    this.email.inBackground(
      'join request rejected',
      this.email.sendJoinRequestRejected({
        to: decided.email,
        name: decided.name,
        orgName: decided.orgName,
        requestId,
        retryAfter: new Date(decided.decidedAt.getTime() + REJECTION_COOLDOWN_HOURS * 3_600_000),
      }),
    );
  }

  /** Counts requests waiting for a moderator, for a badge in the UI. */
  async countPending(m: EntityManager, orgId: string): Promise<number> {
    const [{ count }]: { count: number }[] = await m.query(
      `SELECT count(*)::int AS count FROM org_join_requests WHERE org_id = $1 AND status = 'pending'`,
      [orgId],
    );
    return count;
  }

  /**
   * Marks a pending request decided and returns what the notification email
   * needs. Throws if it is not pending (unknown, or already decided).
   */
  private async decide(
    m: EntityManager,
    me: OrgMembership,
    requestId: string,
    status: typeof OrgJoinRequestStatus.Approved | typeof OrgJoinRequestStatus.Rejected,
  ): Promise<DecidedRequest> {
    const [rows]: [{ user_id: string; decided_at: Date }[], number] = await m.query(
      `UPDATE org_join_requests
       SET status = $3, decided_by = $4, decided_at = now(), updated_at = now()
       WHERE id = $1 AND org_id = $2 AND status = 'pending'
       RETURNING user_id, decided_at`,
      [requestId, me.orgId, status, me.userId],
    );
    if (rows.length === 0) throw requestNotFound();

    const [details]: { email: string; name: string; org_name: string; org_slug: string }[] = await m.query(
      `SELECT u.email, u.name, o.name AS org_name, o.slug AS org_slug
       FROM users u, organisations o
       WHERE u.id = $1 AND o.id = $2`,
      [rows[0].user_id, me.orgId],
    );
    return {
      userId: rows[0].user_id,
      decidedAt: rows[0].decided_at,
      email: details.email,
      name: details.name,
      orgName: details.org_name,
      orgSlug: details.org_slug,
    };
  }
}

interface DecidedRequest {
  userId: string;
  decidedAt: Date;
  email: string;
  name: string;
  orgName: string;
  orgSlug: string;
}
