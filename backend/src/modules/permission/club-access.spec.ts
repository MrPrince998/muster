import { ClubAccess } from './club-access.js';
import { ALL_PERMISSIONS, Permission } from './permissions.js';

const access = (isOwner: boolean, highestPosition: number, permissions: Permission[] = []) =>
  new ClubAccess('club', 'user', isOwner, highestPosition, permissions);

describe('ClubAccess', () => {
  it('has only the permissions of its roles', () => {
    const a = access(false, 20, [Permission.CheckinScan]);
    expect(a.has(Permission.CheckinScan)).toBe(true);
    expect(a.has(Permission.EventCreate)).toBe(false);
    expect(a.missing([Permission.CheckinScan, Permission.EventCreate])).toEqual([
      Permission.EventCreate,
    ]);
  });

  it('gives the owner every permission', () => {
    const owner = access(true, 100);
    expect(ALL_PERMISSIONS.every((p) => owner.has(p))).toBe(true);
  });

  describe('canManageRole', () => {
    const admin = access(false, 40, [Permission.RoleManage]);

    it('allows roles strictly below', () => {
      expect(admin.canManageRole({ position: 30, isOwner: false })).toBe(true);
    });

    it('rejects roles at or above own position', () => {
      expect(admin.canManageRole({ position: 40, isOwner: false })).toBe(false);
      expect(admin.canManageRole({ position: 50, isOwner: false })).toBe(false);
    });

    it('never allows touching the Owner role, even for the owner', () => {
      expect(admin.canManageRole({ position: 100, isOwner: true })).toBe(false);
      expect(access(true, 100).canManageRole({ position: 100, isOwner: true })).toBe(false);
    });

    it('lets the owner manage every other role', () => {
      expect(access(true, 100).canManageRole({ position: 99, isOwner: false })).toBe(true);
    });
  });

  describe('canManageMember', () => {
    const admin = access(false, 40);

    it('allows members ranked below, rejects equals and above', () => {
      expect(admin.canManageMember({ highestPosition: 30, isOwner: false })).toBe(true);
      expect(admin.canManageMember({ highestPosition: 40, isOwner: false })).toBe(false);
    });

    it('never allows acting on the owner', () => {
      expect(admin.canManageMember({ highestPosition: 100, isOwner: true })).toBe(false);
    });
  });
});
