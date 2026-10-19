import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from '../../user/entities/user.entity.js';
import { Event } from './event.entity.js';

/** A code taking a percentage or an amount off an event's paid tickets (migration TicketTypes). Tenant-scoped. */
@Entity('discount_codes')
@Unique('discount_codes_event_id_code_key', ['eventId', 'code'])
@Check(
  'discount_codes_off_check',
  `("percent_off" IS NULL) <> ("amount_off_cents" IS NULL) AND ("percent_off" IS NULL OR "percent_off" BETWEEN 1 AND 100) AND ("amount_off_cents" IS NULL OR "amount_off_cents" > 0)`,
)
@Check('discount_codes_max_uses_check', '"max_uses" IS NULL OR "max_uses" > 0')
export class DiscountCode {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'discount_codes_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  // upper-case; matched ignoring case
  @Column({ type: 'varchar', length: 30 })
  code: string;

  @Column({ name: 'percent_off', type: 'integer', nullable: true })
  percentOff: number | null;

  @Column({ name: 'amount_off_cents', type: 'integer', nullable: true })
  amountOffCents: number | null;

  @Column({ name: 'max_uses', type: 'integer', nullable: true })
  maxUses: number | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'event_id', referencedColumnName: 'id', foreignKeyConstraintName: 'discount_codes_event_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  event?: Event;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'discount_codes_created_by_fkey' })
  creator?: User | null;
}
