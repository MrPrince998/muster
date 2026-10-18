import type { TenantService } from '../../database/tenant.service.js';
import { ClubAccess } from '../permission/club-access.js';
import { ALL_PERMISSIONS, Permission } from '../permission/permissions.js';
import { ClubAdminService, MAX_ROLES } from './club-admin.service.js';

// Owner 100, Admin 40, Organizer 30, Scanner 20, Member 10
const roles = [
  { id: 'r-owner', name: 'Owner', position: 100, permissions: [], is_owner: true },
  { id: 'r-admin', name: 'Admin', position: 40, permissions: [...ALL_PERMISSIONS], is_owner: false },
  { id: 'r-org', name: 'Organizer', position: 30, permissions: [Permission.EventCreate], is_owner: false },
  { id: 'r-scan', name: 'Scanner', position: 20, permissions: [Permission.CheckinScan], is_owner: false },
  { id: 'r-mem', name: 'Member', position: 10, permissions: [], is_owner: false },
];
const owner = new ClubAccess('club1', 'u-owner', true, 100, []);
const admin = new ClubAccess('club1', 'u-admin', false, 40, ALL_PERMISSIONS);
// may manage roles, but holds little else
const lead = new ClubAccess('club1', 'u-lead', false, 30, [Permission.RoleManage, Permission.EventCreate]);

const people: Record<string, { highest_position: number; is_owner: boolean; role_ids: string[] }> = {
  'u-owner': { highest_position: 100, is_owner: true, role_ids: [] },
  'u-admin': { highest_position: 40, is_owner: false, role_ids: ['r-admin'] },
  'u-lead': { highest_position: 30, is_owner: false, role_ids: ['r-org'] },
  'u-ada': { highest_position: 10, is_owner: false, role_ids: ['r-mem'] },
};

/** A fake club: members and roles as above, every statement recorded. */
function setup({ isDefault = false, roleList = roles } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM club_members cm')) {
        const ids = params[1] ? [params[1] as string] : Object.keys(people);
        return ids
          .filter((id) => people[id])
          .map((id) => ({ user_id: id, name: id, joined_at: new Date(), ...people[id] }));
      }
      if (sql.includes('FOR UPDATE')) return roleList;
      if (sql.includes('SELECT is_default')) return [{ is_default: isDefault }];
      if (sql.includes('INSERT INTO roles')) return [{ id: 'r-new' }];
      if (sql.includes('FROM roles r WHERE')) return [];
      return [];
    }),
  };
  const tenant = {
    orgIdForClub: vi.fn().mockResolvedValue('org1'),
    withTenant: vi.fn((_org: string, work: (m: typeof manager) => unknown) => work(manager)),
  };
  return {
    service: new ClubAdminService(tenant as unknown as TenantService),
    ran: (fragment: string) => calls.filter((c) => c.sql.includes(fragment)),
  };
}

describe('ClubAdminService: members', () => {
  it("marks who you can manage: people below you, never yourself or the owner", async () => {
    const { service } = setup();
    const list = await service.members(admin);
    const manageable = Object.fromEntries(list.map((m) => [m.userId, m.manageable]));
    expect(manageable).toEqual({ 'u-owner': false, 'u-admin': false, 'u-lead': true, 'u-ada': true });
  });

  it('gives and takes roles below you, recording who assigned them', async () => {
    const { service, ran } = setup();
    await service.setMemberRoles(admin, 'u-ada', ['r-scan', 'r-org']);
    expect(ran('DELETE FROM member_roles')[0].params[2]).toEqual(['r-mem']);
    expect(ran('INSERT INTO member_roles').map((c) => c.params[2])).toEqual(['r-scan', 'r-org']);
    expect(ran('INSERT INTO member_roles')[0].params[4]).toBe('u-admin');
  });

  it.each([
    ['yourself', admin, 'u-admin', ['r-admin', 'r-org'], 'MEMBER_ABOVE_YOU'],
    ['someone at or above you', lead, 'u-admin', [], 'MEMBER_ABOVE_YOU'],
    ['a role at your own level', lead, 'u-ada', ['r-org'], 'ROLE_ABOVE_YOU'],
    ['the Owner role', owner, 'u-ada', ['r-owner'], 'ROLE_NOT_FOUND'],
    ['a role from elsewhere', owner, 'u-ada', ['r-unknown'], 'ROLE_NOT_FOUND'],
  ])('refuses to change roles for %s', async (_case, access, userId, roleIds, code) => {
    const { service, ran } = setup();
    await expect(service.setMemberRoles(access, userId, roleIds)).rejects.toMatchObject({ code });
    expect(ran('INSERT INTO member_roles')).toHaveLength(0);
    expect(ran('DELETE FROM member_roles')).toHaveLength(0);
  });

  it('removes someone below you, but not from the default club, and not yourself', async () => {
    const ok = setup();
    await ok.service.removeMember(admin, 'u-ada');
    expect(ok.ran('DELETE FROM club_members')[0].params).toEqual(['club1', 'u-ada']);

    await expect(setup({ isDefault: true }).service.removeMember(admin, 'u-ada')).rejects.toMatchObject({
      code: 'DEFAULT_CLUB',
    });
    await expect(setup().service.removeMember(lead, 'u-admin')).rejects.toMatchObject({ code: 'MEMBER_ABOVE_YOU' });
    await expect(setup().service.removeMember(admin, 'u-admin')).rejects.toMatchObject({ code: 'USE_LEAVE' });
  });

  it("lets you leave, unless it's the default club or you own it", async () => {
    const ok = setup();
    await ok.service.leave(admin);
    expect(ok.ran('DELETE FROM club_members')[0].params).toEqual(['club1', 'u-admin']);
    await expect(setup().service.leave(owner)).rejects.toMatchObject({ code: 'OWNS_CLUB' });
    await expect(setup({ isDefault: true }).service.leave(admin)).rejects.toMatchObject({ code: 'DEFAULT_CLUB' });
  });

  it('hands the club over: the new owner gets Owner, the old one the next role down', async () => {
    const { service, ran } = setup();
    await service.transferOwnership(owner, 'u-ada');
    expect(ran('DELETE FROM member_roles WHERE role_id')[0].params).toEqual(['r-owner']);
    const given = ran('INSERT INTO member_roles').map((c) => [c.params[1], c.params[2]]);
    expect(given).toEqual([
      ['u-ada', 'r-owner'],
      ['u-owner', 'r-admin'],
    ]);
    await expect(setup().service.transferOwnership(admin, 'u-ada')).rejects.toMatchObject({ code: 'NOT_OWNER' });
  });
});

describe('ClubAdminService: roles', () => {
  it('creates a role at the bottom and renumbers the rest above it', async () => {
    const { service, ran } = setup();
    await service.createRole(admin, { name: 'Treasurer', permissions: [Permission.AnalyticsView] });
    expect(ran('UPDATE roles r SET position')[0].params[0]).toEqual(['r-new', 'r-mem', 'r-scan', 'r-org', 'r-admin']);
  });

  it("won't give a role a permission you don't hold, on create or edit", async () => {
    await expect(
      setup().service.createRole(lead, { name: 'Door', permissions: [Permission.CheckinScan] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_NOT_YOURS', details: { missing: [Permission.CheckinScan] } });
    await expect(
      setup().service.updateRole(lead, 'r-scan', { permissions: [Permission.CheckinScan, Permission.InviteManage] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_NOT_YOURS', details: { missing: [Permission.InviteManage] } });
  });

  it('keeps permissions a role already had, even ones you lack, when you edit it', async () => {
    const { service, ran } = setup();
    await service.updateRole(lead, 'r-scan', { name: 'Door crew', permissions: [Permission.CheckinScan] });
    expect(ran('UPDATE roles SET name')[0].params).toEqual(['r-scan', 'Door crew', [Permission.CheckinScan]]);
  });

  it('caps the number of roles', async () => {
    const many = Array.from({ length: MAX_ROLES }, (_, i) => ({ ...roles[4], id: `r${i}`, position: i + 1 }));
    await expect(
      setup({ roleList: [roles[0], ...many] }).service.createRole(owner, { name: 'One more', permissions: [] }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ROLES' });
  });

  it('moves a role by swapping it with its neighbour', async () => {
    const { service, ran } = setup();
    await service.moveRole(admin, 'r-mem', 'up');
    expect(ran('UPDATE roles r SET position')[0].params[0]).toEqual(['r-scan', 'r-mem', 'r-org', 'r-admin']);
  });

  it("won't move a role past your own, or off the end", async () => {
    // Scanner up would swap with Organizer, which is lead's own level
    await expect(setup().service.moveRole(lead, 'r-scan', 'up')).rejects.toMatchObject({ code: 'ROLE_ABOVE_YOU' });
    await expect(setup().service.moveRole(owner, 'r-mem', 'down')).rejects.toMatchObject({ code: 'ROLE_AT_EDGE' });
  });

  it('deletes a role below you, clearing it from invite links first', async () => {
    const { service, ran } = setup();
    await service.deleteRole(admin, 'r-scan');
    expect(ran('UPDATE invites SET default_role_id = NULL')[0].params).toEqual(['r-scan']);
    expect(ran('DELETE FROM roles')[0].params).toEqual(['r-scan']);
    await expect(setup().service.deleteRole(lead, 'r-org')).rejects.toMatchObject({ code: 'ROLE_ABOVE_YOU' });
    await expect(setup().service.deleteRole(owner, 'r-owner')).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });
});
