import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { EmailSender, type OutgoingEmail } from '../../src/modules/email/email-sender.js';

/** Captures emails instead of sending them. */
export class CapturingSender extends EmailSender {
  sent: OutgoingEmail[] = [];
  send(email: OutgoingEmail) {
    this.sent.push(email);
    return Promise.resolve();
  }
  tokenFor(to: string, path: string): string {
    const email = this.sent.filter((e) => e.to === to && e.text.includes(path)).at(-1);
    const token = email?.text.match(/token=([\w-]+)/)?.[1];
    if (!token) throw new Error(`no ${path} email for ${to}`);
    return token;
  }
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
  // Authorization header value
  auth: string;
}

/**
 * The full app against the real database, as the e2e tests use it: emails
 * captured, rate limiting off. Users it creates share a random suffix and
 * are deleted (with everything they own via cascades) by close().
 */
export async function createTestApp() {
  const mail = new CapturingSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailSender)
    .useValue(mail)
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app: INestApplication<App> = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();

  const suffix = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());

  /** Signs up, verifies and signs in a new user. */
  async function user(name: string): Promise<TestUser> {
    const email = `${name.toLowerCase()}-${suffix}@example.com`;
    const password = 'correct horse battery staple';
    const signup = await api().post('/auth/signup').send({ email, name, password }).expect(201);
    await api()
      .post('/auth/verify-email')
      .send({ token: mail.tokenFor(email, '/verify-email') })
      .expect(204);
    const signin = await api().post('/auth/signin').send({ email, password }).expect(200);
    const token: string = signin.body.accessToken;
    return { id: signup.body.id, email, name, token, auth: `Bearer ${token}` };
  }

  async function close() {
    const pattern = `%-${suffix}@example.com`;
    // Workspaces are behind RLS, so the app's own connection cannot see them
    // to clean up; the owner connection can. Deleting a workspace cascades to
    // its clubs, roles, events and registrations.
    const owner = await new DataSource({ type: 'postgres', url: process.env.MIGRATION_DATABASE_URL }).initialize();
    try {
      await owner.query(
        `DELETE FROM organisations WHERE id IN (
           SELECT m.org_id FROM org_members m JOIN users u ON u.id = m.user_id WHERE u.email LIKE $1)`,
        [pattern],
      );
      await owner.query(`DELETE FROM users WHERE email LIKE $1`, [pattern]);
    } finally {
      await owner.destroy();
      await app.close();
    }
  }

  return { app, api, mail, user, suffix, close };
}
