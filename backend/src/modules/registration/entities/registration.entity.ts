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
import { Event } from '../../event/entities/event.entity.js';
import { User } from '../../user/entities/user.entity.js';

/**
 * A user's sign-up for an event, and the source of their ticket. Tenant-
 * scoped: carries org_id for RLS.
 *
 * Tickets are not stored. The QR code is a signed JWT carrying this row's id
 * and event_id; a valid signature proves the ticket is genuine, and this row
 * decides whether it can still be used.
 *
 * Guests are ordinary users without a password, so user_id is always set.
 *
 * Lifecycle, expressed with timestamps instead of a status column:
 *   active      cancelled_at IS NULL AND checked_in_at IS NULL
 *   attended    checked_in_at IS NOT NULL
 *   cancelled   cancelled_at IS NOT NULL (frees the seat)
 */
@Entity('registrations')
// one registration per person per event. Re-registering after cancelling
// reactivates the same row, which also keeps the ticket id stable.
@Unique('registrations_event_id_user_id_key', ['eventId', 'userId'])
// a cancelled registration can never have been used, and vice versa
@Check('registrations_cancelled_or_checked_in', `"cancelled_at" IS NULL OR "checked_in_at" IS NULL`)
// "my tickets"
@Index('registrations_user_id_idx', ['userId'])
// counting taken seats during the capacity check. Partial, so it only holds
// active rows: the count stays an index-only scan however many cancel.
@Index('registrations_event_id_active_idx', ['eventId'], { where: `"cancelled_at" IS NULL` })
export class Registration {
  // the ticket id inside the signed QR token
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'registrations_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // set by the atomic check-in:
  //   UPDATE registrations SET checked_in_at = now(), checked_in_by = $2
  //   WHERE id = $1 AND checked_in_at IS NULL AND cancelled_at IS NULL
  // zero rows updated means already used (or cancelled)
  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt: Date | null;

  // the staff member who scanned it
  @Column({ name: 'checked_in_by', type: 'uuid', nullable: true })
  checkedInBy: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  // when they registered; analytics' "registrations over time"
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // (event_id, org_id) must be a real event in that workspace; deleting the
  // event deletes its registrations
  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'event_id', referencedColumnName: 'id', foreignKeyConstraintName: 'registrations_event_fkey' },
    { name: 'org_id', referencedColumnName: 'orgId' },
  ])
  event: Relation<Event>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'registrations_user_id_fkey' })
  user: Relation<User>;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'checked_in_by', foreignKeyConstraintName: 'registrations_checked_in_by_fkey' })
  scanner: Relation<User> | null;
}
