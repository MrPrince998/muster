import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { EmailSender, type OutgoingEmail } from '../../src/modules/email/email-sender.js';
import { FakeGateway, PaymentGateway } from '../../src/modules/payment/payment-gateway.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskStorage, FileStorage } from '../../src/modules/files/file-storage.js';

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
  // a stand-in for Stripe: accounts ready at once, webhooks signed "test"
  const payments = new FakeGateway();
  const uploads = await mkdtemp(join(tmpdir(), 'muster-uploads-'));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailSender)
    .useValue(mail)
    .overrideProvider(PaymentGateway)
    .useValue(payments)
    // uploads go to a folder of their own, gone when the tests are
    .overrideProvider(FileStorage)
    .useValue(new DiskStorage(uploads))
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.useBodyParser('raw', { type: ['image/webp', 'image/jpeg', 'image/png'], limit: '2mb' });
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
      await rm(uploads, { recursive: true, force: true });
    }
  }

  return { app, api, mail, payments, user, suffix, close };
}
