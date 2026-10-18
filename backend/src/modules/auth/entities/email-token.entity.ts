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
} from 'typeorm';
import { User } from '../../user/entities/user.entity.js';

export const EmailTokenPurpose = {
  // sets users.email_verified_at; suggested lifetime 24 hours
  VerifyEmail: 'verify_email',
  // sets a new password and revokes every session; suggested lifetime 30 minutes
  ResetPassword: 'reset_password',
} as const;
export type EmailTokenPurpose = (typeof EmailTokenPurpose)[keyof typeof EmailTokenPurpose];

/**
 * A single-use link sent by email. Not tenant-scoped: no org_id, no RLS.
 *
 * Stores only the SHA-256 of the token in the link. Using it is one atomic
 * statement, so a link can never be used twice, even by two clicks at once:
 *   UPDATE email_tokens SET used_at = now()
 *   WHERE token_hash = $1 AND purpose = $2
 *     AND used_at IS NULL AND expires_at > now()
 *   RETURNING user_id, email
 */
@Entity('email_tokens')
@Check('email_tokens_purpose', `"purpose" IN ('verify_email', 'reset_password')`)
@Check('email_tokens_token_hash_format', `"token_hash" ~ '^[0-9a-f]{64}$'`)
@Check('email_tokens_expires_after_created', `"expires_at" > "created_at"`)
// a user's still-usable tokens of one kind: invalidating the other reset
// links after a successful reset, and rate-limiting how many are sent.
// Partial, so it stays small however many old links pile up.
@Index('email_tokens_user_id_purpose_unused_idx', ['userId', 'purpose'], {
  where: `"used_at" IS NULL`,
})
export class EmailToken {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'email_tokens_pkey' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 30 })
  purpose: EmailTokenPurpose;

  @Index('email_tokens_token_hash_key', { unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  // the address the link was sent to. Verification must confirm this exact
  // address, which matters once users can change their email: a link for the
  // old address must not verify the new one.
  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'email_tokens_user_id_fkey' })
  user: Relation<User>;
}
