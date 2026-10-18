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

// lowercase hex SHA-256: rejects a raw token stored by mistake
const SHA256_HEX = `'^[0-9a-f]{64}$'`;

/**
 * One logged-in device. Not tenant-scoped (a login spans every workspace), so
 * no org_id and no RLS.
 *
 * Holds the hash of the device's current refresh token, never the token. The
 * token is rotated on every refresh, atomically:
 *   UPDATE sessions
 *   SET token_hash = $new, previous_token_hash = token_hash, last_used_at = now()
 *   WHERE token_hash = $old AND revoked_at IS NULL AND expires_at > now()
 *   RETURNING id, user_id
 * Zero rows: invalid, expired, revoked, or already rotated. If $old matches a
 * previous_token_hash instead, an old token is being replayed (likely stolen),
 * so that session is revoked.
 *
 * Logout revokes one session; "log out of all devices" revokes every session
 * of the user. Rows are kept after revocation for the devices screen and
 * reuse detection, and can be purged once expired.
 */
@Entity('sessions')
@Check('sessions_token_hash_format', `"token_hash" ~ ${SHA256_HEX}`)
@Check(
  'sessions_previous_token_hash_format',
  `"previous_token_hash" IS NULL OR "previous_token_hash" ~ ${SHA256_HEX}`,
)
@Check('sessions_expires_after_created', `"expires_at" > "created_at"`)
export class Session {
  // also carried in the access token as `sid`
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'sessions_pkey' })
  id: string;

  // a user's sessions: "log out of all devices" and the devices screen
  @Index('sessions_user_id_idx')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Index('sessions_token_hash_key', { unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  // reuse detection looks sessions up by the token they just replaced
  @Index('sessions_previous_token_hash_idx')
  @Column({ name: 'previous_token_hash', type: 'varchar', length: 64, nullable: true })
  previousTokenHash: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', default: () => 'now()' })
  lastUsedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  // shown on the devices screen; never used for security decisions
  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'sessions_user_id_fkey' })
  user: Relation<User>;
}
