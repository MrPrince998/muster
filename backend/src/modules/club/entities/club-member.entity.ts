import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { OrgMember } from '../../organisation/entities/org-member.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { Club } from './club.entity.js';

/**
 * A user's membership in a club. Tenant-scoped: carries org_id for RLS.
 *
 * No role column: what a member may do comes from the custom roles they hold
 * (member_roles), not from this row.
 *
 * Integrity is enforced by two composite foreign keys rather than plain ones:
 *  - (club_id, org_id) -> clubs(id, org_id): org_id must be the club's real
 *    workspace, so a row can never claim to be in a different tenant.
 *  - (org_id, user_id) -> org_members(org_id, user_id): you can only be in a
 *    club if you are in its workspace, and leaving the workspace removes you
 *    from all of its clubs.
 */
@Entity('club_members')
// "my clubs in this workspace", RLS's org_id filter, and the cascade from
// org_members all look up by (org_id, user_id)
@Index('club_members_org_id_user_id_idx', ['orgId', 'userId'])
export class ClubMember {
  @PrimaryColumn({ name: 'club_id', type: 'uuid', primaryKeyConstraintName: 'club_members_pkey' })
  clubId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid', primaryKeyConstraintName: 'club_members_pkey' })
  userId: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'club_id', referencedColumnName: 'id', foreignKeyConstraintName: 'club_members_club_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  club: Relation<Club>;

  @ManyToOne(() => OrgMember, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'org_id', referencedColumnName: 'orgId', foreignKeyConstraintName: 'club_members_org_member_fkey' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  orgMember: Relation<OrgMember>;

  // for convenient joins only; the org_members key above already guarantees
  // the user exists, so no separate constraint is created
  @ManyToOne(() => User, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
