import { PasswordHasher } from '@nestjs/authentication';
import { DataSource, QueryFailedError } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import type { EmailService } from '../email/email.service.js';
import type { User } from '../user/entities/user.entity.js';
import type { UserService } from '../user/user.service.js';
import type { AccessTokenService } from './access-token.service.js';
import { AuthService } from './auth.service.js';
import type { EmailTokenService } from './email-token.service.js';
import type { SessionService } from './session.service.js';

const dto = { email: 'new@example.com', name: 'New', password: 'correct horse battery' };
const user = { id: 'u1', email: dto.email, name: dto.name } as User;
const meta = { userAgent: 'test', ip: '127.0.0.1' };

function setup(logN = 10) {
  const users = {
    findAccountStatus: vi.fn(),
    createAccount: vi.fn(),
    claimGuestAccount: vi.fn(),
    findSignInCandidate: vi.fn(),
    setPasswordHash: vi.fn(),
    recordSignIn: vi.fn(),
    findOne: vi.fn().mockResolvedValue(user),
    update: vi.fn().mockResolvedValue(user),
  };
  const sessions = { create: vi.fn().mockResolvedValue({ sessionId: 's1', refreshToken: 'r1' }) };
  const accessTokens = { issue: vi.fn().mockResolvedValue({ accessToken: 'a1', expiresIn: 900 }) };
  const emailTokens = { issue: vi.fn().mockResolvedValue({ token: 't1', id: 'et1' }) };
  const email = {
    sendVerifyEmail: vi.fn().mockResolvedValue(undefined),
    // like the real one: never lets a failed send reach the caller
    inBackground: vi.fn((_kind: string, sending: Promise<void>) => void sending.catch(() => undefined)),
  };
  // the default cost (ln=17) is deliberately slow; tests do not need that
  const hasher = new PasswordHasher({ logN });
  const service = new AuthService(
    users as unknown as UserService,
    hasher,
    sessions as unknown as SessionService,
    accessTokens as unknown as AccessTokenService,
    emailTokens as unknown as EmailTokenService,
    email as unknown as EmailService,
    {} as DataSource,
  );
  return { service, users, hasher, sessions, emailTokens, email };
}

function uniqueViolation(constraint: string) {
  return new QueryFailedError(
    'INSERT ...',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505', constraint }),
  );
}

async function expectHttpError(promise: Promise<unknown>, statusCode: number, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ statusCode, code });
}

describe('AuthService.signup', () => {
  it('creates an account with a hash, never the plain password', async () => {
    const { service, users, hasher } = setup();
    users.findAccountStatus.mockResolvedValue(null);
    users.createAccount.mockResolvedValue(user);

    await expect(service.signup(dto)).resolves.toBe(user);

    const saved = users.createAccount.mock.calls[0][0];
    expect(saved).toMatchObject({ email: dto.email, name: dto.name });
    expect(saved).not.toHaveProperty('password');
    await expect(hasher.verify(dto.password, saved.passwordHash)).resolves.toBe(true);
  });

  it('sends a verification email with a fresh token', async () => {
    const { service, users, emailTokens, email } = setup();
    users.findAccountStatus.mockResolvedValue(null);
    users.createAccount.mockResolvedValue(user);

    await service.signup(dto);

    expect(emailTokens.issue).toHaveBeenCalledWith('u1', 'verify_email', dto.email, 24 * 60);
    expect(email.sendVerifyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: dto.email, token: 't1', idempotencyKey: 'et1' }),
    );
  });

  it('carries `next` (an invite link) into the verification email', async () => {
    const { service, users, email } = setup();
    users.findAccountStatus.mockResolvedValue(null);
    users.createAccount.mockResolvedValue(user);

    await service.signup({ ...dto, next: '/join/abc123' });

    expect(email.sendVerifyEmail).toHaveBeenCalledWith(expect.objectContaining({ next: '/join/abc123' }));
  });

  it('sends no `next` when there is none', async () => {
    const { service, users, email } = setup();
    users.findAccountStatus.mockResolvedValue(null);
    users.createAccount.mockResolvedValue(user);

    await service.signup(dto);

    expect(email.sendVerifyEmail.mock.calls[0][0]).not.toHaveProperty('next');
  });

  it('still succeeds when the email fails to send', async () => {
    const { service, users, email } = setup();
    users.findAccountStatus.mockResolvedValue(null);
    users.createAccount.mockResolvedValue(user);
    email.sendVerifyEmail.mockRejectedValue(new Error('provider down'));

    await expect(service.signup(dto)).resolves.toBe(user);
  });

  it('rejects an email that already has an account, without hashing', async () => {
    const { service, users, hasher } = setup();
    const hash = vi.spyOn(hasher, 'hash');
    users.findAccountStatus.mockResolvedValue({ id: 'u1', hasPassword: true });

    await expectHttpError(service.signup(dto), 409, 'EMAIL_TAKEN');
    expect(hash).not.toHaveBeenCalled();
  });

  it('lets a guest claim their existing account', async () => {
    const { service, users } = setup();
    users.findAccountStatus.mockResolvedValue({ id: 'guest', hasPassword: false });
    users.claimGuestAccount.mockResolvedValue(user);

    await expect(service.signup(dto)).resolves.toBe(user);
    expect(users.createAccount).not.toHaveBeenCalled();
  });

  it('rejects a guest claim lost to a concurrent sign-up', async () => {
    const { service, users } = setup();
    users.findAccountStatus.mockResolvedValue({ id: 'guest', hasPassword: false });
    users.claimGuestAccount.mockResolvedValue(null);

    await expectHttpError(service.signup(dto), 409, 'EMAIL_TAKEN');
  });

  it('turns a lost insert race into the same 409', async () => {
    const { service, users } = setup();
    users.findAccountStatus.mockResolvedValue(null);
    users.createAccount.mockRejectedValue(uniqueViolation('users_email_key'));

    await expectHttpError(service.signup(dto), 409, 'EMAIL_TAKEN');
  });

  it('rethrows unexpected errors for the exception filter to log', async () => {
    const { service, users } = setup();
    const failure = new Error('connection lost');
    users.findAccountStatus.mockResolvedValue(null);
    users.createAccount.mockRejectedValue(failure);

    await expect(service.signup(dto)).rejects.toBe(failure);
  });
});

describe('AuthService.signin', () => {
  const credentials = { email: dto.email, password: dto.password };

  async function candidate(hasher: PasswordHasher, overrides: object = {}) {
    return {
      id: 'u1',
      passwordHash: await hasher.hash(dto.password),
      emailVerifiedAt: new Date(),
      ...overrides,
    };
  }

  it('signs in with the right password and starts a session', async () => {
    const { service, users, hasher, sessions } = setup();
    users.findSignInCandidate.mockResolvedValue(await candidate(hasher));

    await expect(service.signin(credentials, meta)).resolves.toEqual({
      accessToken: 'a1',
      tokenType: 'Bearer',
      expiresIn: 900,
      user,
      refreshToken: 'r1',
    });
    expect(sessions.create).toHaveBeenCalledWith('u1', meta);
    expect(users.recordSignIn).toHaveBeenCalledWith('u1');
  });

  it.each([
    ['wrong password', { passwordHash: 'set below' }, 'nope nope nope'],
    ['guest account (no password)', { passwordHash: null }, dto.password],
  ])('rejects a %s as INVALID_CREDENTIALS', async (_case, overrides, password) => {
    const { service, users, hasher, sessions } = setup();
    const base = await candidate(hasher);
    users.findSignInCandidate.mockResolvedValue({
      ...base,
      ...overrides,
      passwordHash: overrides.passwordHash === null ? null : base.passwordHash,
    });

    await expectHttpError(service.signin({ ...credentials, password }, meta), 401, 'INVALID_CREDENTIALS');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown email the same way, still checking a password', async () => {
    const { service, users, hasher } = setup();
    const verify = vi.spyOn(hasher, 'verify');
    users.findSignInCandidate.mockResolvedValue(null);

    await expectHttpError(service.signin(credentials, meta), 401, 'INVALID_CREDENTIALS');
    // a dummy check keeps the timing identical to a real account
    expect(verify).toHaveBeenCalledWith(dto.password, undefined);
  });

  it('blocks unverified accounts, but only after the password is right', async () => {
    const { service, users, hasher, sessions } = setup();
    users.findSignInCandidate.mockResolvedValue(await candidate(hasher, { emailVerifiedAt: null }));

    await expectHttpError(service.signin(credentials, meta), 403, 'EMAIL_NOT_VERIFIED');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('upgrades a hash made with weaker settings', async () => {
    // the service is configured stronger (ln=11) than the stored hash (ln=10)
    const { service, users } = setup(11);
    const weak = await new PasswordHasher({ logN: 10 }).hash(dto.password);
    users.findSignInCandidate.mockResolvedValue({ id: 'u1', passwordHash: weak, emailVerifiedAt: new Date() });

    await service.signin(credentials, meta);
    expect(users.setPasswordHash).toHaveBeenCalledWith('u1', expect.stringMatching(/^\$scrypt\$ln=11,/));
  });
});

describe('SignUpDto next', () => {
  // validated by the DTO, so the email can only ever link back into this app
  const errorsFor = async (next: string) => {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const { SignUpDto } = await import('./dto/auth.dto.js');
    return validate(plainToInstance(SignUpDto, { ...dto, next }));
  };

  it.each(['/join/zKcOC5xfLs1lWhpCXnFB1g', '/o/state-uni?club=abc', '/'])('accepts the path %s', async (next) => {
    expect(await errorsFor(next)).toHaveLength(0);
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'join/abc', '/join/<script>', '/a b'])(
    'refuses %s',
    async (next) => {
      const errors = await errorsFor(next);
      expect(errors.map((e) => e.property)).toContain('next');
    },
  );
});

describe('AuthService.updateProfile', () => {
  it("changes only the signed-in person's own name, trimmed", async () => {
    const { service, users } = setup();
    await service.updateProfile({ id: 'u1', sessionId: 's1' }, { name: '  Ada King  ' });
    expect(users.update).toHaveBeenCalledWith('u1', { name: 'Ada King' });
  });
});
