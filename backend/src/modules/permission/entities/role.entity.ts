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
import { ALL_PERMISSIONS, type Permission } from '../permissions.js';

const permissionList = ALL_PERMISSIONS.map((p) => `'${p}'`).join(', ');

/**
 * A club's custom role: a named set of permissions with a position in the
 * hierarchy. Tenant-scoped: carries org_id for RLS.
 *
 * Hierarchy (prevents privilege escalation): a member can only create, edit,
 * or assign roles whose position is below their own highest role. The service
 * enforces that; the database guarantees positions are unambiguous.
 */
@Entity('roles')
// only permissions that exist in code; '<@' means "is contained by"
@Check('roles_permissions_valid', `"permissions" <@ ARRAY[${permissionList}]::text[]`)
@Check('roles_position_positive', `"position" > 0`)
@Unique('roles_club_id_name_key', ['clubId', 'name'])
// no two roles share a position, so "above" / "below" is always defined.
// Deferred to commit so reordering can swap positions inside one transaction.
@Unique('roles_club_id_position_key', ['clubId', 'position'], { deferrable: 'INITIALLY DEFERRED' })
// one Owner role per club
@Index('roles_one_owner', ['clubId'], { unique: true, where: `"is_owner"` })
// target for member_roles' foreign key: proves an assigned role belongs to the
// same club (and workspace) as the membership it is assigned to
@Unique('roles_id_club_id_org_id_key', ['id', 'clubId', 'orgId'])
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'club_id', type: 'uuid' })
  clubId: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  // higher outranks lower; the Owner role always holds the highest position
  @Column({ type: 'integer' })
  position: number;

  // text[] rather than a join table: permissions are a small fixed set that
  // is always read as a whole when checking access
  @Column({ type: 'text', array: true, default: () => `'{}'` })
  permissions: Permission[];

  // the system Owner role: has every permission, cannot be deleted or demoted
  @Column({ name: 'is_owner', type: 'boolean', default: false })
  isOwner: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // (club_id, org_id) must be a real club in that workspace
  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'club_id', referencedColumnName: 'id', foreignKeyConstraintName: 'roles_club_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  club: Relation<Club>;
}
