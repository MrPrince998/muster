import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../../common/errors/http-error.js';
import { isUniqueViolation } from '../../../common/utils/pg-errors.js';
import { TenantService } from '../../../database/tenant.service.js';
import { ClubService } from '../../club/club.service.js';
import { ALL_PERMISSIONS, Permission } from '../../permission/permissions.js';
import type { OrgMembership } from '../org-roles.js';
import { slugify } from '../slug.js';
import type { ClubSummaryDto, CreateClubDto } from './dto/org-club.dto.js';

const SLUG_CONSTRAINT = 'clubs_org_id_slug_key';

interface ClubSummaryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  member_count: number;
  upcoming_count: number;
  pending_count: number;
  is_owner: boolean;
  permissions: Permission[];
}

const toDto = (row: ClubSummaryRow): ClubSummaryDto => {
  // the Owner role implicitly has every permission (see ClubAccess)
  const permissions = row.is_owner ? [...ALL_PERMISSIONS] : row.permissions;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isDefault: row.is_default,
    memberCount: row.member_count,
    upcomingCount: row.upcoming_count,
    // only approvers learn how many are waiting
    pendingJoinRequests: permissions.includes(Permission.MemberApprove)
      ? row.pending_count
      : 0,
    permissions,
  };
};

// slugify() falls back to "workspace" for names it can't use; a club says "club"
const clubSlug = (name: string) => {
  const slug = slugify(name);
  return slug === 'workspace' && !name.toLowerCase().includes('workspace')
    ? 'club'
    : slug;
};

@Injectable()
export class OrgClubService {
  constructor(
    private readonly tenant: TenantService,
    private readonly clubs: ClubService,
  ) {}

  /** The clubs in this workspace that you belong to: the default club first, then by name. */
  list(me: OrgMembership): Promise<ClubSummaryDto[]> {
    return this.tenant.withTenant(me.orgId, (m) =>
      this.summaries(m, me.userId),
    );
  }

  /**
   * Creates a club with the default roles; you become its Owner. The slug is
   * made from the name, with a random suffix if another club already has it.
   */
  async create(me: OrgMembership, dto: CreateClubDto): Promise<ClubSummaryDto> {
    const base = clubSlug(dto.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug =
        attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      try {
        return await this.tenant.withTenant(me.orgId, async (m) => {
          const { clubId } = await this.clubs.provision(m, {
            orgId: me.orgId,
            name: dto.name.trim(),
            slug,
            description: dto.description?.trim() || null,
            ownerId: me.userId,
          });
          const [club] = await this.summaries(m, me.userId, clubId);
          return club;
        });
      } catch (error) {
        if (!isUniqueViolation(error, SLUG_CONSTRAINT)) throw error;
      }
    }
    throw HttpError.conflict(
      'Could not find a free URL for that name',
      'SLUG_TAKEN',
    );
  }

  // Your clubs (or one of them), each with its counts and your merged
  // permissions. Runs inside withTenant(), so RLS limits it to this workspace.
  private async summaries(
    m: EntityManager,
    userId: string,
    clubId?: string,
  ): Promise<ClubSummaryDto[]> {
    const rows: ClubSummaryRow[] = await m.query(
      `
      SELECT
        c.id, c.name, c.slug, c.description, c.is_default,
        (SELECT count(*) FROM club_members x WHERE x.club_id = c.id)::int AS member_count,
        (SELECT count(*) FROM events e
          WHERE e.club_id = c.id AND e.status = 'published' AND e.starts_at > now())::int AS upcoming_count,
        (SELECT count(*) FROM join_requests jr
          WHERE jr.club_id = c.id AND jr.status = 'pending')::int AS pending_count,
        COALESCE(bool_or(r.is_owner), false) AS is_owner,
        COALESCE(
          array_agg(DISTINCT p.permission) FILTER (WHERE p.permission IS NOT NULL),
          '{}'
        ) AS permissions
      FROM clubs c
      JOIN club_members cm ON cm.club_id = c.id AND cm.user_id = $1
      LEFT JOIN member_roles mr ON mr.club_id = c.id AND mr.user_id = $1
      LEFT JOIN roles r ON r.id = mr.role_id
      LEFT JOIN LATERAL unnest(r.permissions) AS p(permission) ON true
      WHERE ($2::uuid IS NULL OR c.id = $2)
      GROUP BY c.id
      ORDER BY c.is_default DESC, c.name
      `,
      [userId, clubId ?? null],
    );
    return rows.map(toDto);
  }
}
