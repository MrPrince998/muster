import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Event } from '../../event/entities/event.entity.js';
import { User } from '../../user/entities/user.entity.js';
import { TicketType } from '../../event/entities/ticket-type.entity.js';

/**
 * Someone waiting for a place at a full event (migration Waitlist). The
 * oldest waiting entry gets the next place that frees up; promoted entries
 * stay, as history. Tenant-scoped: carries org_id for RLS.
 */
@Entity('waitlist_entries')
@Index('waitlist_entries_waiting_key', ['eventId', 'userId'], { unique: true, where: '"promoted_at" IS NULL' })
@Index('waitlist_entries_queue_idx', ['eventId', 'createdAt'], { where: '"promoted_at" IS NULL' })
export class WaitlistEntry {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'waitlist_entries_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // the ticket type it is (ticket_types); null for an event without types
  @Index('waitlist_entries_ticket_type_id_idx', { where: '"ticket_type_id" IS NOT NULL' })
  @ManyToOne(() => TicketType, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'ticket_type_id', foreignKeyConstraintName: 'waitlist_entries_ticket_type_id_fkey' })
  ticketType?: TicketType | null;

  @Column({ name: 'ticket_type_id', type: 'uuid', nullable: true })
  ticketTypeId: string | null;

  // their answers to the event's questions, by question id
  @Column({ type: 'jsonb', default: {} })
  answers: Record<string, string>;

  @Column({ name: 'promoted_at', type: 'timestamptz', nullable: true })
  promotedAt: Date | null;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'event_id', referencedColumnName: 'id', foreignKeyConstraintName: 'waitlist_entries_event_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  event?: Event;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'waitlist_entries_user_id_fkey' })
  user?: User;
}
