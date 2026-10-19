import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Event } from './event.entity.js';

/** One way into an event: "General $15", "Members free" (migration TicketTypes). Tenant-scoped. */
@Entity('ticket_types')
@Check('ticket_types_price_check', '"price_cents" = 0 OR "price_cents" >= 50')
@Check('ticket_types_capacity_check', '"capacity" IS NULL OR "capacity" > 0')
@Index('ticket_types_event_id_idx', ['eventId', 'position'])
export class TicketType {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'ticket_types_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  // in the event's currency's smallest unit; 0: free
  @Column({ name: 'price_cents', type: 'integer' })
  priceCents: number;

  // at most this many of this type; null: only the event's capacity
  @Column({ type: 'integer', nullable: true })
  capacity: number | null;

  // only for the club's members: not offered on the public page
  @Column({ name: 'members_only', type: 'boolean', default: false })
  membersOnly: boolean;

  // on sale until then (early bird); null: until the event
  @Column({ name: 'sales_end_at', type: 'timestamptz', nullable: true })
  salesEndAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'event_id', referencedColumnName: 'id', foreignKeyConstraintName: 'ticket_types_event_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  event?: Event;
}
