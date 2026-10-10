import { ALL_PERMISSIONS, type Permission } from './permissions.js';

/**
 * What one user may do in one club: the combined permissions of all their
 * roles, plus their place in the role hierarchy.
 */
export class ClubAccess {
  readonly permissions: ReadonlySet<Permission>;

  constructor(
    readonly clubId: string,
    readonly userId: string,
    readonly isOwner: boolean,
    // position of their highest role; 0 if they hold no roles
    readonly highestPosition: number,
    permissions: Iterable<Permission>,
  ) {
    // the Owner role implicitly has every permission
    this.permissions = new Set(isOwner ? ALL_PERMISSIONS : permissions);
  }

  has(permission: Permission): boolean {
    return this.permissions.has(permission);
  }

  missing(required: readonly Permission[]): Permission[] {
    return required.filter((p) => !this.has(p));
  }

  /**
   * Role hierarchy: you can only create, edit, assign or remove roles strictly
   * below your own highest role. The Owner role itself is never manageable.
   */
  canManageRole(role: { position: number; isOwner: boolean }): boolean {
    if (role.isOwner) return false;
    return this.isOwner || role.position < this.highestPosition;
  }

  /** You can only act on (e.g. remove) members whose highest role is below yours. */
  canManageMember(target: { highestPosition: number; isOwner: boolean }): boolean {
    if (target.isOwner) return false;
    return this.isOwner || target.highestPosition < this.highestPosition;
  }
}
