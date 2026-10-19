import { Injectable } from '@nestjs/common';
import { HttpError } from '../../common/errors/http-error.js';
import { TenantService } from '../../database/tenant.service.js';
import type { OrgMembership } from '../organisation/org-roles.js';
import { type AuditAction, AuditAction as A } from './audit.js';
import type { AuditEntryDto, AuditPageDto } from './dto/audit.dto.js';

interface Row {
  id: string;
  action: AuditAction;
  created_at: Date;
  actor_id: string | null;
  actor_name: string | null;
  subject_user_id: string | null;
  subject_name: string | null;
  club_id: string | null;
  club_name: string | null;
  event_id: string | null;
  details: Record<string, unknown>;
}

const ORG_ROLE_NAMES: Record<string, string> = { owner: 'owner', admin: 'admin', moderator: 'moderator', member: 'member' };

const list = (names: unknown) => (Array.isArray(names) && names.length ? names.join(', ') : '');

/**
 * Reading the audit log: a workspace's admins see who changed what, newest
 * first, as sentences ("Olive made Ada an admin"). Names are today's (a
 * renamed person reads under their new name); titles and role names are as
 * they were, kept with each line.
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenant: TenantService) {}

  page(me: OrgMembership, query: { clubId?: string; before?: string; limit?: number }): Promise<AuditPageDto> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const cursor = query.before ? decodeCursor(query.before) : null;
    if (query.before && !cursor) throw HttpError.badRequest('A wrong page cursor', 'INVALID_CURSOR');

    return this.tenant.withTenant(me.orgId, async (m) => {
      const rows: Row[] = await m.query(
        `SELECT a.id, a.action, a.created_at, a.actor_id, actor.name AS actor_name,
                a.subject_user_id, subject.name AS subject_name, a.club_id, c.name AS club_name,
                a.event_id, a.details
         FROM audit_log a
         LEFT JOIN users actor ON actor.id = a.actor_id
         LEFT JOIN users subject ON subject.id = a.subject_user_id
         LEFT JOIN clubs c ON c.id = a.club_id
         WHERE ($1::uuid IS NULL OR a.club_id = $1)
           AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $4`,
        [query.clubId ?? null, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
      );
      const shown = rows.slice(0, limit);
      return {
        entries: shown.map((row) => this.toDto(row)),
        next: rows.length > limit ? encodeCursor(shown.at(-1)!) : null,
      };
    });
  }

  private toDto(row: Row): AuditEntryDto {
    return {
      id: row.id,
      at: row.created_at,
      action: row.action,
      actorName: row.actor_name ?? 'A deleted account',
      clubId: row.club_id,
      clubName: row.club_name,
      eventId: row.event_id,
      summary: describe(row),
    };
  }
}

/** The line as a sentence, without the actor (shown before it) or the time. */
export function describe(row: Pick<Row, 'action' | 'subject_name' | 'club_name' | 'details'>): string {
  const d = row.details as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const who = row.subject_name ?? 'a deleted account';
  const club = row.club_name ?? 'a deleted club';
  const title = d.title ? `“${d.title}”` : 'an event';
  const later = d.alsoLater ? ` and ${d.alsoLater} later in the series` : '';
  switch (row.action) {
    case A.OrgUpdated:
      return `changed the workspace’s ${Object.keys(d)
        .map((key) => ({ name: 'name', slug: 'address', joinPolicy: 'join setting', timeZone: 'time zone' })[key] ?? key)
        .join(' and ')}${d.timeZone ? ` (time zone now ${d.timeZone})` : ''}`;
    case A.OrgMemberRoleChanged:
      return `made ${who} ${d.to === 'admin' ? 'an' : 'a'} ${ORG_ROLE_NAMES[d.to] ?? d.to} (was ${ORG_ROLE_NAMES[d.from] ?? d.from})`;
    case A.OrgMemberRemoved:
      return `removed ${who} from the workspace`;
    case A.OrgOwnershipTransferred:
      return `handed the workspace to ${who}`;
    case A.OrgJoinApproved:
      return `let ${who} into the workspace`;
    case A.OrgJoinRejected:
      return `turned down ${who}’s request to join`;
    case A.ClubCreated:
      return `created the club ${d.name ?? club}`;
    case A.ClubMemberRolesChanged:
      if (list(d.added) && list(d.removed)) return `gave ${who} ${list(d.added)} and took away ${list(d.removed)} in ${club}`;
      if (list(d.added)) return `gave ${who} ${list(d.added)} in ${club}`;
      return `took ${list(d.removed)} away from ${who} in ${club}`;
    case A.ClubMemberRemoved:
      return `removed ${who} from ${club}`;
    case A.ClubOwnershipTransferred:
      return `handed ${club} to ${who}`;
    case A.ClubRoleCreated:
      return `created the role ${d.role} in ${club}`;
    case A.ClubRoleUpdated: {
      const changes = [
        d.was && `renamed it from ${d.was}`,
        list(d.granted) && `allowed ${list(d.granted)}`,
        list(d.revoked) && `stopped ${list(d.revoked)}`,
      ].filter(Boolean);
      return `changed the role ${d.role} in ${club}: ${changes.join('; ')}`;
    }
    case A.ClubRoleDeleted:
      return `deleted the role ${d.role} in ${club}`;
    case A.ClubInviteCreated:
      return `made an invite link for ${club}${d.role ? ` giving ${d.role}` : ''}${d.requiresApproval ? ', with approval' : ''}`;
    case A.ClubInviteRevoked:
      return `turned off an invite link for ${club}`;
    case A.ClubJoinApproved:
      return `let ${who} into ${club}`;
    case A.ClubJoinRejected:
      return `turned down ${who}’s request to join ${club}`;
    case A.EventCreated:
      return `${d.published ? 'published' : 'drafted'} ${title} in ${club}${d.repeat ? `, every ${d.repeat.every}, ${d.repeat.count} times` : ''}`;
    case A.EventPublished:
      return `published ${title}${later}`;
    case A.EventUpdated:
      return `edited ${title}${later} (${list(d.fields)})`;
    case A.EventRegistrationClosed:
      return `closed registration for ${title}`;
    case A.EventRegistrationOpened:
      return `reopened registration for ${title}`;
    case A.EventCancelled:
      return `cancelled ${title}${later}${d.told ? `, telling ${d.told} ${d.told === 1 ? 'person' : 'people'}` : ''}`;
    case A.EventDeleted:
      return `deleted the draft ${title}${later}`;
    case A.EventAttendeesExported:
      return `downloaded the attendee list for ${title} (${d.people} ${d.people === 1 ? 'person' : 'people'})`;
    case A.PaymentsConnected:
      return 'started connecting a Stripe account, to sell tickets';
    case A.EventManualCheckIn:
      return `checked ${who} in by name, without a ticket`;
    default:
      return row.action;
  }
}

// "<created_at ISO>_<id>", base64url: the last line shown, to continue after
function encodeCursor(row: Row): string {
  return Buffer.from(`${row.created_at.toISOString()}_${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } | null {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('_');
  return at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
}
