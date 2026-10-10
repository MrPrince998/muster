/**
 * Every permission in the system. A fixed list, defined only here: clubs build
 * roles out of these, but can never invent new ones.
 *
 * The roles table has a CHECK constraint generated from this list, so adding
 * or removing a permission needs a migration.
 */
export const Permission = {
  EventCreate: 'event.create',
  EventPublish: 'event.publish',
  EventManageOwn: 'event.manage_own',
  EventManageAny: 'event.manage_any',
  RegistrationView: 'registration.view',
  CheckinScan: 'checkin.scan',
  AnalyticsView: 'analytics.view',
  MemberApprove: 'member.approve',
  MemberRemove: 'member.remove',
  InviteManage: 'invite.manage',
  RoleManage: 'role.manage',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

/**
 * Roles every new club starts with (README: "Roles and permissions"). Owners
 * can edit or extend them. Position: higher outranks lower.
 *
 * Owner is not listed: it is a system role (is_owner) that implicitly has
 * every permission and always sits at the top.
 */
export const DEFAULT_ROLES: readonly { name: string; position: number; permissions: Permission[] }[] = [
  { name: 'Admin', position: 40, permissions: [...ALL_PERMISSIONS] },
  {
    name: 'Organizer',
    position: 30,
    permissions: [
      Permission.EventCreate,
      Permission.EventPublish,
      Permission.EventManageOwn,
      Permission.RegistrationView,
      Permission.AnalyticsView,
      Permission.CheckinScan,
    ],
  },
  { name: 'Scanner', position: 20, permissions: [Permission.CheckinScan] },
  { name: 'Member', position: 10, permissions: [] },
];
