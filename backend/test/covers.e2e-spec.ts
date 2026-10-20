import { randomBytes } from 'node:crypto';
import { createTestApp, type TestUser } from './support/test-app.js';

/**
 * Cover images: an organiser puts one on an event (the image bytes as the
 * request body), it shows on the event and its public page, and it's served
 * from /files for anyone with the link, cached for good. Only images, only
 * small ones, only by people who can edit the event.
 */

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: TestUser;
let ada: TestUser;
let clubId = '';
let eventId = '';

// the smallest real PNG: a 1x1 pixel
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// a WebP's header is enough for telling what it is
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), randomBytes(32)]);

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.user('Olive');
  ada = await t.user('Ada');
  const org = await t.api().post('/orgs').set('Authorization', owner.auth).send({ name: `Covers ${t.suffix}`, joinPolicy: 'open' }).expect(201);
  await t.api().post(`/orgs/by-slug/${org.body.slug}/join`).set('Authorization', ada.auth).expect(201);
  clubId = (await t.api().get(`/orgs/${org.body.id}/clubs`).set('Authorization', owner.auth).expect(200)).body[0].id;
  const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  eventId = (
    await t
      .api()
      .post(`/clubs/${clubId}/events`)
      .set('Authorization', owner.auth)
      .send({ title: 'Photo Walk', startsAt: at(2), endsAt: at(2.1), visibility: 'public', publish: true })
      .expect(201)
  ).body.id;
});
afterAll(() => t.close());

const upload = (u: TestUser, data: Buffer, type: string) =>
  t.api().put(`/clubs/${clubId}/events/${eventId}/cover`).set('Authorization', u.auth).set('Content-Type', type).send(data);

describe('cover images', () => {
  it('takes an image, shows it on the event and its public page, and serves it for good', async () => {
    const res = await upload(owner, png, 'image/png').expect(200);
    expect(res.body.coverUrl).toMatch(/^\/files\/covers\/[0-9a-f-]{36}\.png$/);
    expect((await t.api().get(`/public/events/${eventId}`).expect(200)).body.coverUrl).toBe(res.body.coverUrl);

    const file = await t.api().get(res.body.coverUrl).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.compare(file.body, png)).toBe(0);
  });

  it('replaces it under a new name, and the old file goes', async () => {
    const before = (await t.api().get(`/clubs/${clubId}/events/${eventId}`).set('Authorization', owner.auth).expect(200)).body.coverUrl;
    const after = (await upload(owner, webp, 'image/webp').expect(200)).body.coverUrl;
    expect(after).toMatch(/\.webp$/);
    expect(after).not.toBe(before);
    await t.api().get(before).expect(404);
    await t.api().get(after).expect(200);
  });

  it("goes by what the bytes are, not what they're called, and only small ones", async () => {
    const text = Buffer.from('<script>alert(1)</script>'.padEnd(64, ' '));
    expect((await upload(owner, text, 'image/png').expect(400)).body.code).toBe('IMAGE_NOT_SUPPORTED');
    const big = Buffer.concat([png, randomBytes(2 * 1024 * 1024)]);
    await upload(owner, big, 'image/png').expect(413);
    await t.api().put(`/clubs/${clubId}/events/${eventId}/cover`).set('Authorization', owner.auth).send({ image: 'x' }).expect(400);
  });

  it('is for people who can edit the event', async () => {
    expect((await upload(ada, png, 'image/png').expect(403)).body.code).toBe('MISSING_PERMISSION');
  });

  it('comes off, file and all', async () => {
    const url = (await t.api().get(`/clubs/${clubId}/events/${eventId}`).set('Authorization', owner.auth).expect(200)).body.coverUrl;
    const res = await t.api().delete(`/clubs/${clubId}/events/${eventId}/cover`).set('Authorization', owner.auth).expect(200);
    expect(res.body.coverUrl).toBeNull();
    await t.api().get(url).expect(404);
  });

  it("serves nothing outside its folder, whatever's asked", async () => {
    await t.api().get('/files/covers/..%2F..%2Fpackage.json').expect(404);
    await t.api().get('/files/secrets/anything.png').expect(404);
  });
});
