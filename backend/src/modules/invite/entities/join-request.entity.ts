import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity.js';
import { Invite } from './invite.entity.js';

export const JoinRequestStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const;
export type JoinRequestStatus = (typeof JoinRequestStatus)[keyof typeof JoinRequestStatus];

/**
 * A request to join a club through an invite link that requires approval.
 * Tenant-scoped: carries org_id for RLS.
 *
 * The requester is usually not a member of the workspace yet, so user_id
 * points at users, not org_members. Approving runs in one transaction: add
 * org_members (if missing), club_members, the invite's default role, then mark
 * the request approved. Decided requests are kept as the audit trail.
 */
@Entity('join_requests')
@Check('join_requests_status', `"status" IN ('pending', 'approved', 'rejected')`)
// decided exactly when no longer pending: no "approved" row without a
// decision time, no pending row with one
@Check('join_requests_decided', `("status" = 'pending') = ("decided_at" IS NULL)`)
// one open request per person per club. Partial, so a rejected user can ask
// again later and history is kept. club_id first, so it also serves the
// approval queue ("pending requests in this club").
@Index('join_requests_one_pending', ['clubId', 'userId'], {
  unique: true,
  where: `"status" = 'pending'`,
})
// "my requests"
@Index('join_requests_user_id_idx', ['userId'])
export class JoinRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'club_id', type: 'uuid' })
  clubId: string;

  // the link they used: decides the role granted on approval
  @Column({ name: 'invite_id', type: 'uuid' })
  inviteId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20, default: JoinRequestStatus.Pending })
  status: JoinRequestStatus;

  // who approved or rejected it (member.approve); null while pending, or if
  // that user was later deleted
  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // (invite_id, club_id, org_id) must match the invite, so the request's club
  // and workspace are the link's. Club deletion reaches here through invites.
  @ManyToOne(() => Invite, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'invite_id', referencedColumnName: 'id', foreignKeyConstraintName: 'join_requests_invite_fkey' },
    { name: 'club_id', referencedColumnName: 'clubId' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  invite: Relation<Invite>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'join_requests_user_id_fkey' })
  user: Relation<User>;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by', foreignKeyConstraintName: 'join_requests_decided_by_fkey' })
  decider: Relation<User> | null;
}
