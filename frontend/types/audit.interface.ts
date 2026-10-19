/** GET /orgs/:orgId/audit: one line of the workspace's audit log. */
export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  // who did it, under today's name
  actorName: string;
  // what they did, to follow their name: "made Ada an admin (was member)"
  summary: string;
  clubId: string | null;
  clubName: string | null;
  eventId: string | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  // pass as `before` for older lines; null at the end
  next: string | null;
}
