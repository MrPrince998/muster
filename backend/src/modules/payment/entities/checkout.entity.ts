import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Event } from '../../event/entities/event.entity.js';
import { User } from '../../user/entities/user.entity.js';

/**
 * Someone paying for a place (migration PaidTickets): it holds the place
 * until it's paid or expires. Tenant-scoped: carries org_id for RLS.
 */
@Entity('checkouts')
@Unique('checkouts_session_id_key', ['sessionId'])
@Check('checkouts_status_check', `"status" IN ('pending', 'paid', 'expired', 'refunded')`)
@Index('checkouts_held_idx', ['eventId', 'expiresAt'], { where: `"status" = 'pending'` })
export class Checkout {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'checkouts_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'session_id', type: 'varchar', length: 255, nullable: true })
  sessionId: string | null;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: 'pending' | 'paid' | 'expired' | 'refunded';

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'registration_id', type: 'uuid', nullable: true })
  registrationId: string | null;

  // their answers to the event's questions, by question id
  @Column({ type: 'jsonb', default: {} })
  answers: Record<string, string>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'event_id', referencedColumnName: 'id', foreignKeyConstraintName: 'checkouts_event_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  event?: Event;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'checkouts_user_id_fkey' })
  user?: User;
}
