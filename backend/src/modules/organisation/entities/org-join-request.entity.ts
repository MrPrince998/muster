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
import { Organisation } from './organisation.entity.js';

export const OrgJoinRequestStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  // withdrawn by the person who asked
  Cancelled: 'cancelled',
} as const;
export type OrgJoinRequestStatus = (typeof OrgJoinRequestStatus)[keyof typeof OrgJoinRequestStatus];

/**
 * A request to join a workspace whose join policy is "request", like
 * Discord's "apply to join". A moderator or above approves or rejects it.
 * Tenant-scoped: carries org_id and gets an RLS policy.
 *
 * Separate from join_requests, which are club-level and always come from an
 * invite link. Decided rows are kept as the audit trail and to enforce a
 * cooldown after rejection.
 */
@Entity('org_join_requests')
@Check('org_join_requests_status', `"status" IN ('pending', 'approved', 'rejected', 'cancelled')`)
// decided (or withdrawn) exactly when no longer pending
@Check('org_join_requests_decided', `("status" = 'pending') = ("decided_at" IS NULL)`)
// one open request per person per workspace; org_id first, so it also serves
// the moderators' queue
@Index('org_join_requests_one_pending', ['orgId', 'userId'], {
  unique: true,
  where: `"status" = 'pending'`,
})
@Index('org_join_requests_user_id_idx', ['userId'])
export class OrgJoinRequest {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'org_join_requests_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20, default: OrgJoinRequestStatus.Pending })
  status: OrgJoinRequestStatus;

  // optional note to the moderators: "I'm in the robotics lab"
  @Column({ type: 'varchar', length: 500, nullable: true })
  message: string | null;

  // who approved or rejected it; null while pending, when cancelled by the
  // requester, or if that moderator's account was deleted
  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id', foreignKeyConstraintName: 'org_join_requests_org_id_fkey' })
  organisation: Relation<Organisation>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'org_join_requests_user_id_fkey' })
  user: Relation<User>;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by', foreignKeyConstraintName: 'org_join_requests_decided_by_fkey' })
  decider: Relation<User> | null;
}
