import type { PasswordHasher } from '@nestjs/authentication';
import type { Repository } from 'typeorm';
import type { TenantService } from '../../database/tenant.service.js';
import type { User } from './entities/user.entity.js';
import { UserService } from './user.service.js';

const user = { id: 'u1', email: 'me@example.com', name: 'Me' } as User;
const workspace = (role: string) => ({ orgId: 'o1', name: 'Robotics', slug: 'robotics', role, joinedAt: new Date() });

function setup(workspaces: ReturnType<typeof workspace>[]) {
  const repo = {
    findOneBy: vi.fn().mockResolvedValue(user),
    remove: vi.fn().mockResolvedValue(user),
    // findPasswordHash's query builder
    createQueryBuilder: vi.fn(() => {
      const qb = { select: () => qb, addSelect: () => qb, where: () => qb, getOne: async () => ({ passwordHash: 'hash' }) };
      return qb;
    }),
  };
  const tenant = { userOrganisations: vi.fn().mockResolvedValue(workspaces) };
  const hasher = { verify: vi.fn(async (password: string) => password === 'right') };
  const service = new UserService(
    repo as unknown as Repository<User>,
    tenant as unknown as TenantService,
    hasher as unknown as PasswordHasher,
  );
  return { repo, tenant, service };
}

describe('UserService.removeAccount', () => {
  it('deletes an account that owns no workspace', async () => {
    const { repo, service } = setup([workspace('admin'), workspace('member')]);
    await service.removeAccount('u1', 'right');
    expect(repo.remove).toHaveBeenCalledWith(user);
  });

  it('refuses while you still own a workspace, and names it', async () => {
    const { repo, service } = setup([workspace('owner')]);
    await expect(service.removeAccount('u1', 'right')).rejects.toMatchObject({
      code: 'OWNS_WORKSPACE',
      details: { workspaces: [{ name: 'Robotics', slug: 'robotics' }] },
    });
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('refuses a wrong password before looking at anything else', async () => {
    const { repo, tenant, service } = setup([]);
    await expect(service.removeAccount('u1', 'wrong')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    expect(tenant.userOrganisations).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
