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
import { ClubMember } from '../../club/entities/club-member.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { Role } from './role.entity.js';

/**
 * A role held by a club member. A member can hold several roles; their
 * permissions combine. Tenant-scoped: carries org_id for RLS.
 *
 * Two composite foreign keys keep it consistent:
 *  - (club_id, user_id) -> club_members: only members of the club hold its
 *    roles, and leaving the club drops them.
 *  - (role_id, club_id, org_id) -> roles: the role belongs to that same club
 *    and workspace, so a role from club A can never be assigned in club B.
 */
@Entity('member_roles')
// "who holds this role" and the cascade when a role is deleted
@Index('member_roles_role_id_idx', ['roleId'])
export class MemberRole {
  @PrimaryColumn({ name: 'club_id', type: 'uuid', primaryKeyConstraintName: 'member_roles_pkey' })
  clubId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid', primaryKeyConstraintName: 'member_roles_pkey' })
  userId: string;

  @PrimaryColumn({ name: 'role_id', type: 'uuid', primaryKeyConstraintName: 'member_roles_pkey' })
  roleId: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  // audit trail: who granted it. Null if that user was later deleted, or for
  // roles assigned by the system (the creator becoming Owner).
  @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
  assignedBy: string | null;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @ManyToOne(() => ClubMember, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'club_id', referencedColumnName: 'clubId', foreignKeyConstraintName: 'member_roles_club_member_fkey' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  clubMember: Relation<ClubMember>;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'role_id', referencedColumnName: 'id', foreignKeyConstraintName: 'member_roles_role_fkey' },
    { name: 'club_id', referencedColumnName: 'clubId' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  role: Relation<Role>;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by', foreignKeyConstraintName: 'member_roles_assigned_by_fkey' })
  assigner: Relation<User> | null;
}
