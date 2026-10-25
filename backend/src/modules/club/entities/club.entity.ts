import {
  BeforeInsert,
  BeforeUpdate,
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
import { Organisation } from '../../organisation/entities/organisation.entity.js';

/**
 * A unit inside a workspace with its own members, roles, invites and events.
 * Tenant-scoped: carries org_id and gets an RLS policy.
 *
 * Every workspace has exactly one default club, created with the workspace.
 * Small groups only ever use that one and never see the word "club".
 */
@Entity('clubs')
// same format as organisation slugs: lowercase letters, digits, single hyphens
@Check('clubs_slug_format', `"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
// slugs are unique per workspace, not globally: /o/state-uni/c/coding and
// /o/city-tech/c/coding can both exist. org_id first so this index also
// serves "all clubs in this workspace" and RLS's org_id filter.
@Index('clubs_org_id_slug_key', ['orgId', 'slug'], { unique: true })
// target for composite foreign keys from tenant-scoped child tables
// (club_members, roles, events, ...), which proves a child's org_id is
// really its club's workspace
@Unique('clubs_id_org_id_key', ['id', 'orgId'])
// at most one default club per workspace
@Index('clubs_one_default', ['orgId'], { unique: true, where: `"is_default"` })
// trigram search on names (migration 1760000000005; TypeORM can't express the operator class)
@Index('clubs_name_trgm_idx', { synchronize: false })
@Check('clubs_join_policy_check', `"join_policy" IN ('open', 'request', 'invite')`)
export class Club {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'clubs_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // the default club cannot be deleted; the service enforces that
  // who can join: anyone in the workspace, by asking, or only with an invite link
  @Column({ name: 'join_policy', type: 'varchar', length: 20, default: 'invite' })
  joinPolicy: 'open' | 'request' | 'invite';

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // deleting a workspace removes its clubs (and, through them, everything below)
  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id', foreignKeyConstraintName: 'clubs_org_id_fkey' })
  organisation: Relation<Organisation>;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeSlug() {
    this.slug = this.slug?.trim().toLowerCase();
  }
}
