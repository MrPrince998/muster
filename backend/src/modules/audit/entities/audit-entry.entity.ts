import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Organisation } from '../../organisation/entities/organisation.entity.js';
import { User } from '../../user/entities/user.entity.js';

/**
 * One line of a workspace's audit log (migration AuditLog): who did what,
 * when. Append-only for the app. Tenant-scoped: carries org_id for RLS.
 */
@Entity('audit_log')
@Index('audit_log_org_id_created_at_idx', ['orgId', 'createdAt', 'id'])
@Index('audit_log_club_id_created_at_idx', ['clubId', 'createdAt'])
export class AuditEntry {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'audit_log_pkey' })
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ name: 'club_id', type: 'uuid', nullable: true })
  clubId: string | null;

  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId: string | null;

  @Column({ name: 'subject_user_id', type: 'uuid', nullable: true })
  subjectUserId: string | null;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id', foreignKeyConstraintName: 'audit_log_org_id_fkey' })
  organisation?: Organisation;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id', foreignKeyConstraintName: 'audit_log_actor_id_fkey' })
  actor?: User | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_user_id', foreignKeyConstraintName: 'audit_log_subject_user_id_fkey' })
  subject?: User | null;
}
