import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { EmailSender, type OutgoingEmail } from '../src/modules/email/email-sender.js';

/**
 * The whole auth flow against the real app and database, as a browser would
 * use it. Emails are captured instead of sent; rate limiting is off.
 */

class CapturingSender extends EmailSender {
  sent: OutgoingEmail[] = [];
  send(email: OutgoingEmail) {
    this.sent.push(email);
    return Promise.resolve();
  }
  /** The token from the latest email to `to` matching `path`. */
  tokenFor(to: string, path: string): string {
    const email = this.sent.filter((e) => e.to === to && e.text.includes(path)).at(-1);
    const token = email?.text.match(/token=([\w-]+)/)?.[1];
    if (!token) throw new Error(`no ${path} email for ${to}`);
    return token;
  }
}

const suffix = randomUUID().slice(0, 8);
const emailOf = (name: string) => `${name}-${suffix}@example.com`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication<App>;
let mail: CapturingSender;

const api = () => request(app.getHttpServer());

/** The refresh_token cookie from a response, as a Cookie header value. */
function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('refresh_token=') && !c.startsWith('refresh_token=;'));
  if (!cookie) throw new Error('no refresh_token cookie set');
  return cookie.split(';')[0];
}

async function signUpAndVerify(email: string, password = PASSWORD) {
  await api().post('/auth/signup').send({ email, name: 'Test', password }).expect(201);
  await api()
    .post('/auth/verify-email')
    .send({ token: mail.tokenFor(email, '/verify-email') })
    .expect(204);
}

async function signIn(email: string, password = PASSWORD) {
  const res = await api().post('/auth/signin').send({ email, password }).expect(200);
  return { accessToken: res.body.accessToken as string, cookie: refreshCookie(res), res };
}

beforeAll(async () => {
  mail = new CapturingSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailSender)
    .useValue(mail)
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
});

afterAll(async () => {
  // sessions and email tokens cascade from users
  await app?.get(DataSource).query(`DELETE FROM users WHERE email LIKE $1`, [`%-${suffix}@example.com`]);
  await app?.close();
});

describe('auth (e2e)', () => {
  it('requires a token on every route that is not @Public()', async () => {
    await api().get('/').expect(200);
    const res = await api().get('/auth/me').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    await api().get('/user').expect(401);
  });

  describe('sign-up, verification, sign-in', () => {
    const email = emailOf('ada');

    it('signs up and emails a verification link', async () => {
      const res = await api().post('/auth/signup').send({ email, name: 'Ada', password: PASSWORD }).expect(201);
      expect(res.body).toMatchObject({ email, name: 'Ada', emailVerifiedAt: null });
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(mail.tokenFor(email, '/verify-email')).toHaveLength(43);
    });

    it('rejects a second sign-up with the same email', async () => {
      const res = await api()
        .post('/auth/signup')
        .send({ email: email.toUpperCase(), name: 'Again', password: PASSWORD })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
    });

    it('refuses sign-in until the email is verified', async () => {
      const res = await api().post('/auth/signin').send({ email, password: PASSWORD }).expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('verifies the email once; the link cannot be reused', async () => {
      const token = mail.tokenFor(email, '/verify-email');
      await api().post('/auth/verify-email').send({ token }).expect(204);
      const res = await api().post('/auth/verify-email').send({ token }).expect(400);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      const wrong = await api().post('/auth/signin').send({ email, password: 'not my password' }).expect(401);
      const unknown = await api()
        .post('/auth/signin')
        .send({ email: emailOf('nobody'), password: PASSWORD })
        .expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body).toMatchObject({ code: wrong.body.code, message: wrong.body.message });
    });

    it('signs in: access token in the body, refresh token only in an httpOnly cookie', async () => {
      const { accessToken, res } = await signIn(email);
      expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: expect.any(Number) });
      expect(res.body).not.toHaveProperty('refreshToken');

      const cookie = ([] as string[]).concat(res.headers['set-cookie']).join('; ');
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/auth/);

      const me = await api().get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
      expect(me.body).toMatchObject({ email, lastLoginAt: expect.any(String) });
    });

    it('rejects a tampered access token', async () => {
      const { accessToken } = await signIn(email);
      const tampered = accessToken.slice(0, -2) + (accessToken.endsWith('a') ? 'bb' : 'aa');
      const res = await api().get('/auth/me').set('Authorization', `Bearer ${tampered}`).expect(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });
  });

  describe('refresh tokens', () => {
    const email = emailOf('refresh');
    beforeAll(() => signUpAndVerify(email));

    it('rotates: each refresh token works exactly once', async () => {
      const { cookie } = await signIn(email);
      const first = await api().post('/auth/refresh').set('Cookie', cookie).expect(200);
      const next = refreshCookie(first);
      expect(next).not.toBe(cookie);

      await api().get('/auth/me').set('Authorization', `Bearer ${first.body.accessToken}`).expect(200);
      await api().post('/auth/refresh').set('Cookie', next).expect(200);
    });

    it('treats a reused refresh token as theft and ends that session', async () => {
      const { cookie: stolen } = await signIn(email);
      const legit = await api().post('/auth/refresh').set('Cookie', stolen).expect(200);

      // the attacker replays the old token
      const replay = await api().post('/auth/refresh').set('Cookie', stolen).expect(401);
      expect(replay.body.code).toBe('INVALID_REFRESH_TOKEN');

      // ...which also ends the session the legitimate client was using
      await api().post('/auth/refresh').set('Cookie', refreshCookie(legit)).expect(401);
      await api().get('/auth/me').set('Authorization', `Bearer ${legit.body.accessToken}`).expect(401);
    });

    it('rejects a missing refresh token', async () => {
      await api().post('/auth/refresh').expect(401);
    });
  });

  describe('sessions and sign-out', () => {
    const email = emailOf('devices');
    beforeAll(() => signUpAndVerify(email));

    it('logs out one device: its refresh and access tokens stop working', async () => {
      const { accessToken, cookie } = await signIn(email);
      await api().post('/auth/logout').set('Cookie', cookie).expect(204);
      await api().post('/auth/refresh').set('Cookie', cookie).expect(401);
      const res = await api().get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
      expect(res.body.code).toBe('SESSION_ENDED');
    });

    it('lists devices and signs one out remotely', async () => {
      const laptop = await signIn(email);
      const phone = await signIn(email);

      const list = await api().get('/auth/sessions').set('Authorization', `Bearer ${laptop.accessToken}`).expect(200);
      const current = list.body.filter((s: { current: boolean }) => s.current);
      expect(current).toHaveLength(1);
      const phoneSession = list.body.find((s: { current: boolean }) => !s.current);

      await api()
        .delete(`/auth/sessions/${phoneSession.id}`)
        .set('Authorization', `Bearer ${laptop.accessToken}`)
        .expect(204);
      await api().get('/auth/me').set('Authorization', `Bearer ${phone.accessToken}`).expect(401);
      await api().get('/auth/me').set('Authorization', `Bearer ${laptop.accessToken}`).expect(200);
    });

    it("cannot sign out someone else's session", async () => {
      const other = emailOf('other');
      await signUpAndVerify(other);
      const theirs = await signIn(other);
      const theirSessions = await api()
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${theirs.accessToken}`)
        .expect(200);

      const mine = await signIn(email);
      await api()
        .delete(`/auth/sessions/${theirSessions.body[0].id}`)
        .set('Authorization', `Bearer ${mine.accessToken}`)
        .expect(404);
      await api().get('/auth/me').set('Authorization', `Bearer ${theirs.accessToken}`).expect(200);
    });

    it('logs out of every device at once, effective immediately', async () => {
      const a = await signIn(email);
      const b = await signIn(email);
      await api().post('/auth/logout-all').set('Authorization', `Bearer ${a.accessToken}`).expect(204);

      for (const device of [a, b]) {
        await api().get('/auth/me').set('Authorization', `Bearer ${device.accessToken}`).expect(401);
        await api().post('/auth/refresh').set('Cookie', device.cookie).expect(401);
      }
    });
  });

  describe('passwords', () => {
    const email = emailOf('reset');
    beforeAll(() => signUpAndVerify(email));

    it('answers forgot-password identically for unknown emails, and sends nothing', async () => {
      const before = mail.sent.length;
      await api().post('/auth/forgot-password').send({ email: emailOf('ghost') }).expect(202);
      expect(mail.sent).toHaveLength(before);
    });

    it('resets the password with the emailed link and signs out everywhere', async () => {
      const session = await signIn(email);
      await api().post('/auth/forgot-password').send({ email }).expect(202);
      const token = mail.tokenFor(email, '/reset-password');

      const newPassword = 'a brand new passphrase';
      await api().post('/auth/reset-password').send({ token, password: newPassword }).expect(204);

      await api().get('/auth/me').set('Authorization', `Bearer ${session.accessToken}`).expect(401);
      await api().post('/auth/signin').send({ email, password: PASSWORD }).expect(401);
      await signIn(email, newPassword);

      // single use
      await api().post('/auth/reset-password').send({ token, password: 'another one entirely' }).expect(400);
    });

    it('only the newest reset link works', async () => {
      await api().post('/auth/forgot-password').send({ email }).expect(202);
      const older = mail.tokenFor(email, '/reset-password');
      await api().post('/auth/forgot-password').send({ email }).expect(202);

      const res = await api().post('/auth/reset-password').send({ token: older, password: 'whatever it is' }).expect(400);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('changes the password, keeping this device and signing out the others', async () => {
      const current = 'a brand new passphrase';
      const here = await signIn(email, current);
      const elsewhere = await signIn(email, current);

      const wrong = await api()
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${here.accessToken}`)
        .send({ currentPassword: 'not it at all', newPassword: 'changed passphrase' })
        .expect(403);
      expect(wrong.body.code).toBe('INVALID_PASSWORD');

      await api()
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${here.accessToken}`)
        .send({ currentPassword: current, newPassword: 'changed passphrase' })
        .expect(204);

      await api().get('/auth/me').set('Authorization', `Bearer ${here.accessToken}`).expect(200);
      await api().get('/auth/me').set('Authorization', `Bearer ${elsewhere.accessToken}`).expect(401);
      await signIn(email, 'changed passphrase');
    });
  });

  describe('guest accounts', () => {
    const email = emailOf('guest');

    beforeAll(async () => {
      await app.get(DataSource).query(`INSERT INTO users (email, name) VALUES ($1, 'Guest')`, [email]);
    });

    it('cannot sign in', async () => {
      await api().post('/auth/signin').send({ email, password: PASSWORD }).expect(401);
    });

    it('can claim the account by signing up, but must verify before signing in', async () => {
      const res = await api().post('/auth/signup').send({ email, name: 'Real Guest', password: PASSWORD }).expect(201);
      expect(res.body.name).toBe('Real Guest');
      await api().post('/auth/signin').send({ email, password: PASSWORD }).expect(403);
    });
  });
});
