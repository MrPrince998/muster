import { Exclude } from 'class-transformer';
import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';

// Emails are compared case-insensitively. Normalising on the way in and in
// WHERE clauses (TypeORM applies transformers to find conditions too) keeps
// the unique index meaningful: Foo@X.com and foo@x.com are the same account.
// Exported for hand-written queries, which transformers do not reach.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const emailTransformer: ValueTransformer = {
  to: (value?: string | null) => (value == null ? value : normalizeEmail(value)),
  from: (value: string) => value,
};

/**
 * A person, across all workspaces. Not tenant-scoped: workspace and club
 * membership live in org_members / club_members, so this table has no org_id
 * and no RLS policy.
 *
 * Guests (public event registrations) are users with no password. A guest
 * becomes a full account by registering with the same email, which sets
 * password_hash instead of creating a second row.
 */
@Entity('users')
// trigram search on names (migration 1760000000005; TypeORM can't express the operator class)
@Index('users_name_trgm_idx', { synchronize: false })
export class User {
  // UUIDs, not serial ints: ids appear in URLs and ticket tokens, so they
  // must not be guessable or leak how many users exist.
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'users_pkey' })
  id: string;

  @Index('users_email_key', { unique: true })
  @Column({ type: 'varchar', length: 320, transformer: emailTransformer })
  email: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  // bcrypt hash; null for guest accounts. select: false keeps it out of every
  // query unless explicitly requested (e.g. addSelect in the login query), and
  // @Exclude keeps it out of every API response.
  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // the transformer only rewrites what is sent to the database; this also
  // fixes the in-memory entity so responses after save() show the stored value
  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    if (this.email != null) this.email = normalizeEmail(this.email);
  }
}
