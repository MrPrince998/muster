/** GET /clubs/:clubId/analytics: a club's attendance, computed live. */
export interface ClubAttendance {
  summary: {
    // published events that are over (cancelled ones never happened)
    eventsHeld: number;
    upcomingEvents: number;
    registered: number;
    attended: number;
    // attended / registered, 0 to 1; null before any registrations
    attendanceRate: number | null;
    // places at events held taken by people outside the workspace
    guests: number;
  };
  // the last 12 months, oldest first: "2026-10"
  months: { month: string; events: number; registered: number; attended: number }[];
  // latest first, drafts never
  events: {
    id: string;
    title: string;
    startsAt: string;
    status: "published" | "cancelled";
    ended: boolean;
    capacity: number | null;
    registered: number;
    attended: number;
    guests: number;
  }[];
}
