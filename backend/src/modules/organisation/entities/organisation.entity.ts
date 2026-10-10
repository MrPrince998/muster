import {
  BeforeInsert,
  BeforeUpdate,
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * How people get into the workspace. Stored as varchar + CHECK rather than a
 * Postgres enum: adding a value to an enum type needs its own migration step
 * and values can never be removed, while a CHECK is a one-line change.
 */
export const JoinPolicy = {
  // only through an invite link (default)
  Invite: 'invite',
  // anyone with an account can join
  Open: 'open',
} as const;
export type JoinPolicy = (typeof JoinPolicy)[keyof typeof JoinPolicy];

/**
 * The workspace, and the tenant: the hard data-isolation boundary. Every
 * tenant-scoped table (clubs, events, registrations, ...) carries an org_id
 * pointing here, and RLS limits each request to the current org.
 *
 * Ownership is not stored here. The owner is whoever holds the Owner role in
 * org_members, so transferring ownership never touches this row.
 */
@Entity('organisations')
// lowercase letters, digits and single hyphens, no leading/trailing hyphen
@Check('organisations_slug_format', `"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('organisations_join_policy', `"join_policy" IN ('invite', 'open')`)
export class Organisation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  // public URL identifier: /o/state-uni. Can be renamed, so other tables
  // reference id, never slug.
  @Index('organisations_slug_key', { unique: true })
  @Column({ type: 'varchar', length: 50 })
  slug: string;

  @Column({ name: 'join_policy', type: 'varchar', length: 20, default: JoinPolicy.Invite })
  joinPolicy: JoinPolicy;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeSlug() {
    this.slug = this.slug?.trim().toLowerCase();
  }
}
