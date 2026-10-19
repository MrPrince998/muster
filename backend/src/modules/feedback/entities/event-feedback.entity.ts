import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Event } from '../../event/entities/event.entity.js';
import { Registration } from '../../registration/entities/registration.entity.js';

/**
 * "How was it?" (migration EventFeedback): a rating and an optional comment
 * from someone who came, one per place. Organisers see them without names.
 * Tenant-scoped: carries org_id for RLS.
 */
@Entity('event_feedback')
@Unique('event_feedback_registration_id_key', ['registrationId'])
@Check('event_feedback_rating_check', '"rating" BETWEEN 1 AND 5')
@Index('event_feedback_event_id_idx', ['eventId'])
export class EventFeedback {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'event_feedback_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'registration_id', type: 'uuid' })
  registrationId: string;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'event_id', referencedColumnName: 'id', foreignKeyConstraintName: 'event_feedback_event_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  event?: Event;

  @OneToOne(() => Registration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'registration_id', foreignKeyConstraintName: 'event_feedback_registration_fkey' })
  registration?: Registration;
}
