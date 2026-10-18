import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity.js';
import { Organisation } from './organisation.entity.js';

/**
 * Workspace-level role. Deliberately a fixed list: the customisable,
 * Discord-style roles live at club level (roles / member_roles). Workspace
 * roles only decide who runs the workspace itself.
 */
export const OrgRole = {
  // exactly one per workspace; can delete it and transfer ownership
  Owner: 'owner',
  // manages the workspace: settings, clubs, members
  Admin: 'admin',
  // keeps the door: approves join requests and removes members
  Moderator: 'moderator',
  // belongs to the workspace and can join its clubs
  Member: 'member',
} as const;
export type OrgRole = (typeof OrgRole)[keyof typeof OrgRole];

/**
 * A user's membership in a workspace. Tenant-scoped: carries org_id and gets
 * an RLS policy, so a request only ever sees memberships of the current org.
 *
 * The primary key is (org_id, user_id): a user is in a workspace at most once,
 * and the API addresses a membership as /orgs/:orgId/members/:userId.
 */
@Entity('org_members')
@Check('org_members_role', `"role" IN ('owner', 'admin', 'moderator', 'member')`)
// at most one owner per workspace, enforced by the database so two concurrent
// ownership transfers can never leave a workspace with two owners
@Index('org_members_one_owner', ['orgId'], { unique: true, where: `"role" = 'owner'` })
export class OrgMember {
  @PrimaryColumn({ name: 'org_id', type: 'uuid', primaryKeyConstraintName: 'org_members_pkey' })
  orgId: string;

  // the PK starts with org_id, so "which workspaces is this user in" needs its own index
  @Index('org_members_user_id_idx')
  @PrimaryColumn({ name: 'user_id', type: 'uuid', primaryKeyConstraintName: 'org_members_pkey' })
  userId: string;

  @Column({ type: 'varchar', length: 20, default: OrgRole.Member })
  role: OrgRole;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // deleting a workspace removes its memberships
  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id', foreignKeyConstraintName: 'org_members_org_id_fkey' })
  organisation: Relation<Organisation>;

  // deleting a user removes their memberships. The service must refuse to
  // delete a user who still owns a workspace, or that workspace loses its owner.
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'org_members_user_id_fkey' })
  user: Relation<User>;
}
