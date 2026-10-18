import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Event } from '../../event/entities/event.entity.js';
import { User } from '../../user/entities/user.entity.js';

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
