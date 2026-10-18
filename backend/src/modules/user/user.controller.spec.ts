import { HttpError } from '../../common/errors/http-error.js';
import type { User } from './entities/user.entity.js';
import { UserController } from './user.controller.js';
import type { UserService } from './user.service.js';

const me = { id: '11111111-1111-4111-8111-111111111111', sessionId: 's1' };
const someoneElse = '22222222-2222-4222-8222-222222222222';
const user = { id: me.id, email: 'me@example.com', name: 'Me' } as User;

function setup() {
  const users = {
    findOne: vi.fn().mockResolvedValue(user),
    update: vi.fn().mockResolvedValue(user),
    removeAccount: vi.fn().mockResolvedValue(undefined),
  };
  return { users, controller: new UserController(users as unknown as UserService) };
}

const notFound = (call: () => Promise<unknown>) =>
  expect(call()).rejects.toMatchObject({ code: 'USER_NOT_FOUND' } satisfies Partial<HttpError>);

describe('UserController', () => {
  it('reads, renames and deletes your own account', async () => {
    const { users, controller } = setup();
    await controller.findOne(me, me.id);
    await controller.update(me, me.id, { name: '  New name  ' });
    await controller.remove(me, me.id, { password: 'pw' });
    expect(users.findOne).toHaveBeenCalledWith(me.id);
    expect(users.update).toHaveBeenCalledWith(me.id, { name: 'New name' });
    expect(users.removeAccount).toHaveBeenCalledWith(me.id, 'pw');
  });

  it("answers 404 for anyone else's account, without touching it", async () => {
    const { users, controller } = setup();
    await notFound(() => Promise.resolve().then(() => controller.findOne(me, someoneElse)));
    await notFound(() => Promise.resolve().then(() => controller.update(me, someoneElse, { name: 'Hijacked' })));
    await notFound(() => Promise.resolve().then(() => controller.remove(me, someoneElse, { password: 'pw' })));
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
    expect(users.removeAccount).not.toHaveBeenCalled();
  });

  it('only lets you change your name, never your email', async () => {
    const { users, controller } = setup();
    await controller.update(me, me.id, { name: 'Me', email: 'attacker@evil.test' } as never);
    expect(users.update).toHaveBeenCalledWith(me.id, { name: 'Me' });
  });
});
