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
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Club } from '../../club/entities/club.entity.js';
import { User } from '../../user/entities/user.entity.js';

export const EventVisibility = {
  // only members of the club can see and register
  Members: 'members',
  // anyone, including guests with just a name and email
  Public: 'public',
} as const;
export type EventVisibility = (typeof EventVisibility)[keyof typeof EventVisibility];

export const EventStatus = {
  // visible only to people who can manage it; no registrations
  Draft: 'draft',
  // listed and open for registration
  Published: 'published',
  // kept for history and analytics; registrations closed, tickets rejected
  Cancelled: 'cancelled',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

// how often a recurring event repeats
export const REPEAT_EVERY = ['week', 'fortnight', 'month'] as const;
export type RepeatEvery = (typeof REPEAT_EVERY)[number];

/**
 * An event run by a club. Tenant-scoped: carries org_id for RLS.
 *
 * There is deliberately no registered_count column. Capacity is checked by
 * locking the event row (SELECT ... FOR UPDATE) and counting active
 * registrations inside the same transaction, so a counter could only drift
 * out of sync, never make the check safer.
 */
@Entity('events')
@Check('events_visibility', `"visibility" IN ('members', 'public')`)
@Check('events_status', `"status" IN ('draft', 'published', 'cancelled')`)
@Check('events_ends_after_start', `"ends_at" > "starts_at"`)
@Check('events_capacity_positive', `"capacity" IS NULL OR "capacity" > 0`)
// a published or cancelled event must have been published at some point
@Check('events_published_at', `"status" = 'draft' OR "published_at" IS NOT NULL`)
// cancelled exactly when it has a cancellation time; only a cancelled event has a reason
@Check('events_cancelled_at', `("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)`)
@Check('events_cancel_reason', `"cancel_reason" IS NULL OR "status" = 'cancelled'`)
@Check('events_repeat_every_check', `"repeat_every" IN ('week', 'fortnight', 'month')`)
// in a series exactly when it has a rule
@Check('events_series_check', `("series_id" IS NULL) = ("repeat_every" IS NULL)`)
// a club's events by date: the main listing and calendar query
@Index('events_club_id_starts_at_idx', ['clubId', 'startsAt'])
// a series in order, for "this and following" and "3 of 8"
@Index('events_series_idx', ['seriesId', 'startsAt'], { where: '"series_id" IS NOT NULL' })
// target for registrations' foreign key: proves a registration's org_id is
// really its event's workspace
@Unique('events_id_org_id_key', ['id', 'orgId'])
// trigram search on titles (migration 1760000000005; TypeORM can't express the operator class)
@Index('events_title_trgm_idx', { synchronize: false })
// the reminder sweep: published events by start (migration 1760000000007)
@Index('events_starts_at_published_idx', ['startsAt'], { where: `"status" = 'published'` })
export class Event {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'events_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'club_id', type: 'uuid' })
  clubId: string;

  // who created it; event.manage_own checks against this. Null if that user
  // was deleted: the event stays, only manage_any can then edit it.
  @Index('events_created_by_idx')
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // free text: a room, an address, or a meeting link
  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  // maximum active registrations; null means unlimited
  @Column({ type: 'integer', nullable: true })
  capacity: number | null;

  @Column({ type: 'varchar', length: 20, default: EventVisibility.Members })
  visibility: EventVisibility;

  @Column({ type: 'varchar', length: 20, default: EventStatus.Draft })
  status: EventStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  // set: no new registrations, though the event still runs; null: open
  @Column({ name: 'registration_closed_at', type: 'timestamptz', nullable: true })
  registrationClosedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  // the organiser's note to the people registered, shown with the cancellation
  @Column({ name: 'cancel_reason', type: 'varchar', length: 500, nullable: true })
  cancelReason: string | null;

  // the events made together from one "repeats weekly, 8 times"; null for a one-off
  @Column({ name: 'series_id', type: 'uuid', nullable: true })
  seriesId: string | null;

  @Column({ name: 'repeat_every', type: 'text', nullable: true })
  repeatEvery: RepeatEvery | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // (club_id, org_id) must be a real club in that workspace; deleting the
  // club deletes its events
  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'club_id', referencedColumnName: 'id', foreignKeyConstraintName: 'events_club_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  club: Relation<Club>;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'events_created_by_fkey' })
  creator: Relation<User> | null;
}
