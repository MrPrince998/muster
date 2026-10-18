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
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Club } from '../../club/entities/club.entity.js';
import { Role } from '../../permission/entities/role.entity.js';
import { User } from '../../user/entities/user.entity.js';

/**
 * An invite link into a club (/join/:code). Tenant-scoped: carries org_id for
 * RLS. Joining through it also adds the user to the workspace if needed.
 *
 * Using a link is a single atomic statement, so two people can never both
 * take the last use:
 *   UPDATE invites SET use_count = use_count + 1
 *   WHERE code = $1 AND revoked_at IS NULL
 *     AND (expires_at IS NULL OR expires_at > now())
 *     AND (max_uses IS NULL OR use_count < max_uses)
 *   RETURNING ...
 * Zero rows means invalid, revoked, expired, or used up. The CHECK on
 * use_count is a second line of defence if that WHERE clause is ever wrong.
 *
 * A link that requires approval is "used" when the request is made, not when
 * it is approved, so max_uses also caps the number of pending requests.
 */
@Entity('invites')
@Check('invites_max_uses_positive', `"max_uses" IS NULL OR "max_uses" > 0`)
@Check('invites_use_count_in_range', `"use_count" >= 0 AND ("max_uses" IS NULL OR "use_count" <= "max_uses")`)
// a club's invite links, for the management screen
@Index('invites_club_id_idx', ['clubId'])
// target for join_requests' foreign key
@Unique('invites_id_club_id_org_id_key', ['id', 'clubId', 'orgId'])
export class Invite {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'invites_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'club_id', type: 'uuid' })
  clubId: string;

  // the secret in the link: generated from crypto.randomBytes, base64url.
  // Unique across all workspaces because /join/:code has no tenant in it.
  @Index('invites_code_key', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  code: string;

  // role given on joining; null joins with no roles. Must be a role of the
  // same club. Deleting a role still used by an invite fails, so the service
  // has to repoint or revoke those invites first rather than silently
  // changing what the link grants.
  @Column({ name: 'default_role_id', type: 'uuid', nullable: true })
  defaultRoleId: string | null;

  @Column({ name: 'requires_approval', type: 'boolean', default: false })
  requiresApproval: boolean;

  // null means unlimited
  @Column({ name: 'max_uses', type: 'integer', nullable: true })
  maxUses: number | null;

  @Column({ name: 'use_count', type: 'integer', default: 0 })
  useCount: number;

  // null means never expires
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  // revoked instead of deleted, so join requests keep pointing at their link
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'club_id', referencedColumnName: 'id', foreignKeyConstraintName: 'invites_club_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  club: Relation<Club>;

  // NO ACTION, not RESTRICT: checked at the end of the statement, so deleting
  // a whole club (which cascades to both roles and invites) still works
  @ManyToOne(() => Role, { onDelete: 'NO ACTION' })
  @JoinColumn([
    { name: 'default_role_id', referencedColumnName: 'id', foreignKeyConstraintName: 'invites_default_role_fkey' },
    { name: 'club_id', referencedColumnName: 'clubId' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  defaultRole: Relation<Role> | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'invites_created_by_fkey' })
  creator: Relation<User> | null;
}
