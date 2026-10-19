import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../user/entities/user.entity.js';
import { Event } from './event.entity.js';

/** A message an organiser sent everyone going to an event (migration EventMessages). Tenant-scoped. */
@Entity('event_messages')
@Index('event_messages_event_id_created_at_idx', ['eventId', 'createdAt'])
export class EventMessage {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'event_messages_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId: string | null;

  @Column({ type: 'varchar', length: 150 })
  subject: string;

  @Column({ type: 'varchar', length: 5000 })
  body: string;

  @Column({ name: 'to_waitlist', type: 'boolean', default: false })
  toWaitlist: boolean;

  @Column({ name: 'recipient_count', type: 'integer' })
  recipientCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'event_id', referencedColumnName: 'id', foreignKeyConstraintName: 'event_messages_event_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  event?: Event;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sender_id', foreignKeyConstraintName: 'event_messages_sender_id_fkey' })
  sender?: User | null;
}
