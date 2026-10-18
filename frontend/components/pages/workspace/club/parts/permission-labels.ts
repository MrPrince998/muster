import type { ClubPermission } from "@/types";

/** What each permission lets someone do, in the words people use. Grouped as the role editor shows them. */
export const PERMISSION_GROUPS: { title: string; permissions: { value: ClubPermission; label: string; hint: string }[] }[] = [
  {
    title: "Events",
    permissions: [
      { value: "event.create", label: "Create events", hint: "Draft new events for the club." },
      { value: "event.publish", label: "Publish events", hint: "Make drafts visible and open for registration." },
      { value: "event.manage_own", label: "Edit their own events", hint: "Change, close or cancel events they created." },
      { value: "event.manage_any", label: "Edit anyone's events", hint: "Change, close or cancel any of the club's events." },
    ],
  },
  {
    title: "On the day",
    permissions: [
      { value: "registration.view", label: "See who's going", hint: "The attendee list of each event." },
      { value: "checkin.scan", label: "Check people in", hint: "Scan tickets at the door." },
      { value: "analytics.view", label: "See attendance numbers", hint: "How many registered and came." },
    ],
  },
  {
    title: "People",
    permissions: [
      { value: "invite.manage", label: "Manage invite links", hint: "Create and revoke the club's invite links." },
      { value: "member.approve", label: "Approve join requests", hint: "Let people in through links that need approval." },
      { value: "member.remove", label: "Remove members", hint: "Take people below them out of the club." },
      { value: "role.manage", label: "Manage roles", hint: "Create roles and give them to people below them." },
    ],
  },
];

export const PERMISSION_LABEL = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => [p.value, p.label])),
) as Record<ClubPermission, string>;
