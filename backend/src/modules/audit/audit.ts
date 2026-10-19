import type { EntityManager } from 'typeorm';

/** Everything the audit log records. */
export const AuditAction = {
  OrgUpdated: 'org.updated',
  OrgMemberRoleChanged: 'org.member_role_changed',
  OrgMemberRemoved: 'org.member_removed',
  OrgOwnershipTransferred: 'org.ownership_transferred',
  OrgJoinApproved: 'org.join_approved',
  OrgJoinRejected: 'org.join_rejected',
  ClubCreated: 'club.created',
  ClubMemberRolesChanged: 'club.member_roles_changed',
  ClubMemberRemoved: 'club.member_removed',
  ClubOwnershipTransferred: 'club.ownership_transferred',
  ClubRoleCreated: 'club.role_created',
  ClubRoleUpdated: 'club.role_updated',
  ClubRoleDeleted: 'club.role_deleted',
  ClubInviteCreated: 'club.invite_created',
  ClubInviteRevoked: 'club.invite_revoked',
  ClubJoinApproved: 'club.join_approved',
  ClubJoinRejected: 'club.join_rejected',
  EventCreated: 'event.created',
  EventPublished: 'event.published',
  EventUpdated: 'event.updated',
  EventRegistrationClosed: 'event.registration_closed',
  EventRegistrationOpened: 'event.registration_opened',
  EventCancelled: 'event.cancelled',
  EventDeleted: 'event.deleted',
  EventAttendeesExported: 'event.attendees_exported',
  EventManualCheckIn: 'event.manual_check_in',
  EventMessaged: 'event.messaged',
  EventCodeCreated: 'event.code_created',
  PaymentsConnected: 'payments.connected',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditRecord {
  // who did it
  actorId: string;
  action: AuditAction;
  clubId?: string | null;
  eventId?: string | null;
  // the person it was done to
  subjectUserId?: string | null;
  // what it was, as it was then: titles, role names, before and after
  details?: Record<string, unknown>;
}

/**
 * Adds a line to the workspace's audit log. Call it inside the transaction
 * that makes the change (withTenant), so the change and its record commit
 * together or not at all; the workspace is the transaction's own.
 */
export async function audit(m: EntityManager, entry: AuditRecord): Promise<void> {
  await m.query(
    `INSERT INTO audit_log (org_id, actor_id, action, club_id, event_id, subject_user_id, details)
     VALUES (current_org_id(), $1, $2, $3, $4, $5, $6)`,
    [
      entry.actorId,
      entry.action,
      entry.clubId ?? null,
      entry.eventId ?? null,
      entry.subjectUserId ?? null,
      JSON.stringify(entry.details ?? {}),
    ],
  );
}
