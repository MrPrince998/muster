/**
 * The load test: builds one big workspace and times the lists that grow
 * with it, through the API, as its owner and as a plain member.
 *
 *   pnpm load-test            builds the workspace (once), then times
 *   pnpm load-test --reset    deletes it first and builds it again
 *   pnpm load-test --remove   deletes it, and stops
 *
 * Local only: it writes straight to the database (MIGRATION_DATABASE_URL)
 * and calls the API at API_URL (default http://localhost:5001), which
 * should run with THROTTLE_DISABLED=true. Everything it makes is on the
 * reserved .test domain and in a workspace with the slug "load-test".
 */
import 'dotenv/config';
import 'reflect-metadata';
import { PasswordHasher } from '@nestjs/authentication';
import { DataSource, type EntityManager } from 'typeorm';
import { ClubService } from '../src/modules/club/club.service.js';

const SLUG = 'load-test';
const DOMAIN = 'load.test';
const PASSWORD = 'load-test-password';
const PEOPLE = 5000;
const CLUBS = 30;
const PER_CLUB = 300;
const PAST_EVENTS = 500;
const PER_EVENT = 150;
const BIG_EVENT = 3000;
const API = process.env.API_URL ?? 'http://localhost:5001';

const url = process.env.MIGRATION_DATABASE_URL?.replace('@db:', '@localhost:');
if (!url) throw new Error('Set MIGRATION_DATABASE_URL');
if (process.env.NODE_ENV === 'production') throw new Error('The load test is for a local database only');

function inTenant<T>(ds: DataSource, orgId: string, work: (m: EntityManager) => Promise<T>): Promise<T> {
  return ds.transaction(async (m) => {
    await m.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    return work(m);
  });
}

async function remove(ds: DataSource) {
  const [org]: { id: string }[] = await ds.query(`SELECT org_id_for_slug($1) AS id`, [SLUG]);
  if (org?.id) await inTenant(ds, org.id, (m) => m.query(`DELETE FROM organisations WHERE id = $1`, [org.id]));
  await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]);
}

async function build(ds: DataSource) {
  const started = Date.now();
  const hash = await new PasswordHasher().hash(PASSWORD);
  // people: load-0@load.test is the owner, load-1 a plain member
  await ds.query(
    `INSERT INTO users (email, name, password_hash, email_verified_at, created_at)
     SELECT 'load-' || i || '@${DOMAIN}', 'Person ' || lpad(i::text, 5, '0'), $1, now(), now() - (i || ' minutes')::interval
     FROM generate_series(0, $2 - 1) i`,
    [hash, PEOPLE],
  );
  const orgId = (await ds.query(`SELECT gen_random_uuid() AS id`))[0].id as string;
  await inTenant(ds, orgId, async (m) => {
    await m.query(`INSERT INTO organisations (id, name, slug, join_policy) VALUES ($1, 'Load Test', $2, 'request')`, [orgId, SLUG]);
    const owner = (await m.query(`SELECT id FROM users WHERE email = $1`, [`load-0@${DOMAIN}`]))[0].id;
    await m.query(
      `INSERT INTO org_members (org_id, user_id, role)
       SELECT $1, id, CASE WHEN email = 'load-0@${DOMAIN}' THEN 'owner' ELSE 'member' END
       FROM users WHERE email LIKE $2`,
      [orgId, `%@${DOMAIN}`],
    );
    const clubs = new ClubService();
    const general = await clubs.provision(m, { orgId, name: 'General', slug: 'general', isDefault: true, ownerId: owner });
    await m.query(
      `INSERT INTO club_members (club_id, user_id, org_id) SELECT $1, user_id, $2 FROM org_members WHERE org_id = $2
       ON CONFLICT DO NOTHING`,
      [general.clubId, orgId],
    );
    // clubs of 300, overlapping; the first is the busy one, owned by the owner
    for (let c = 0; c < CLUBS; c++) {
      const { clubId } = await clubs.provision(m, { orgId, name: `Club ${c + 1}`, slug: `club-${c + 1}`, isDefault: false, ownerId: owner });
      await m.query(`UPDATE clubs SET join_policy = 'request' WHERE id = $1`, [clubId]);
      await m.query(
        `INSERT INTO club_members (club_id, user_id, org_id)
         SELECT $1, u.id, $2 FROM users u
         WHERE u.email LIKE $3 AND (split_part(split_part(u.email, '-', 2), '@', 1)::int + $4 * 37) % $5 < $6
         ON CONFLICT DO NOTHING`,
        [clubId, orgId, `%@${DOMAIN}`, c, PEOPLE, PER_CLUB],
      );
      if (c > 0) continue;
      // the busy club: a long past, each event 150 going (most came), and one huge upcoming one
      await m.query(
        `INSERT INTO events (org_id, club_id, created_by, title, starts_at, ends_at, status, published_at, visibility)
         SELECT $1, $2, $3, 'Past night ' || i, now() - (i || ' days')::interval, now() - (i || ' days')::interval + interval '2 hours',
                'published', now() - (i + 30 || ' days')::interval, 'members'
         FROM generate_series(1, $4) i`,
        [orgId, clubId, owner, PAST_EVENTS],
      );
      await m.query(
        `INSERT INTO registrations (org_id, event_id, user_id, created_at, checked_in_at)
         SELECT $1, e.id, cm.user_id, e.starts_at - interval '3 days',
                CASE WHEN abs(hashtext(e.id::text || cm.user_id::text)) % 10 < 7 THEN e.starts_at END
         FROM events e
         CROSS JOIN LATERAL (
           SELECT user_id FROM club_members WHERE club_id = $2 ORDER BY hashtext(user_id::text || e.id::text) LIMIT $3
         ) cm
         WHERE e.club_id = $2`,
        [orgId, clubId, PER_EVENT],
      );
      const [{ id: big }]: { id: string }[] = await m.query(
        `INSERT INTO events (org_id, club_id, created_by, title, starts_at, ends_at, status, published_at, visibility)
         VALUES ($1, $2, $3, 'The big one', now() + interval '10 days', now() + interval '10 days 3 hours', 'published', now(), 'members')
         RETURNING id`,
        [orgId, clubId, owner],
      );
      await m.query(
        `INSERT INTO registrations (org_id, event_id, user_id, created_at)
         SELECT $1, $2, user_id, now() - (row_number() OVER () || ' seconds')::interval
         FROM org_members WHERE org_id = $1 LIMIT $3`,
        [orgId, big, BIG_EVENT],
      );
      // waiting to join the busy club, and the workspace (plus a long decided history)
      await m.query(
        `INSERT INTO join_requests (org_id, club_id, user_id, message, created_at)
         SELECT $1, $2, om.user_id, 'Please', now() - (row_number() OVER () || ' minutes')::interval
         FROM org_members om WHERE om.org_id = $1
           AND NOT EXISTS (SELECT 1 FROM club_members x WHERE x.club_id = $2 AND x.user_id = om.user_id)
         LIMIT 300`,
        [orgId, clubId],
      );
    }
    await m.query(
      `INSERT INTO users (email, name, password_hash, created_at)
       SELECT 'applicant-' || i || '@${DOMAIN}', 'Applicant ' || i, NULL, now() FROM generate_series(1, 2400) i`,
    );
    await m.query(
      `INSERT INTO org_join_requests (org_id, user_id, message, status, created_at, decided_at, decided_by)
       SELECT $1, u.id, 'Hello', CASE WHEN n <= 400 THEN 'pending' ELSE 'rejected' END,
              now() - (n || ' minutes')::interval, CASE WHEN n > 400 THEN now() END, CASE WHEN n > 400 THEN $2::uuid END
       FROM (SELECT id, row_number() OVER (ORDER BY email) AS n FROM users WHERE email LIKE 'applicant-%@${DOMAIN}') u`,
      [orgId, owner],
    );
    await m.query(
      `INSERT INTO audit_log (org_id, actor_id, action, created_at, details)
       SELECT $1, $2, 'org.updated', now() - (i || ' seconds')::interval, '{"name":"Load Test"}'::jsonb
       FROM generate_series(1, 20000) i`,
      [orgId, owner],
    );
  });
  await ds.query(`ANALYZE`);
  console.log(`Built the load-test workspace in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

// --- timing, through the API ----------------------------------------------------

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in for ${email}: ${res.status}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// the median of a few runs, after one to warm up
async function time(label: string, token: string, path: string) {
  await get(token, path);
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    await get(token, path);
    runs.push(performance.now() - started);
  }
  const median = runs.sort((a, b) => a - b)[2];
  console.log(`${median.toFixed(0).padStart(6)} ms  ${label}`);
  return median;
}

async function measure(ds: DataSource) {
  const [org]: { id: string }[] = await ds.query(`SELECT org_id_for_slug($1) AS id`, [SLUG]);
  const ids = await inTenant(ds, org.id, async (m) => ({
    // this connection owns the tables, so it sees past RLS: name the workspace
    general: (await m.query(`SELECT id FROM clubs WHERE org_id = $1 AND is_default`, [org.id]))[0].id as string,
    busy: (await m.query(`SELECT id FROM clubs WHERE org_id = $1 AND slug = 'club-1'`, [org.id]))[0].id as string,
    big: (await m.query(`SELECT id FROM events WHERE org_id = $1 AND title = 'The big one'`, [org.id]))[0].id as string,
  }));
  const owner = await signIn(`load-0@${DOMAIN}`);
  const member = await signIn(`load-1@${DOMAIN}`);

  console.log(`\nThrough the API (median of 5), ${PEOPLE} members, ${PAST_EVENTS} past events of ${PER_EVENT}:`);
  const results = [
    await time('workspace members, first page (owner)', owner, `/orgs/${org.id}/members`),
    await time('workspace members, first page (plain member)', member, `/orgs/${org.id}/members`),
    await time('workspace members, searched (owner)', owner, `/orgs/${org.id}/members?q=Person%2004`),
    await time('General members, first page (plain member)', member, `/clubs/${ids.general}/members`),
    await time('club members, first page (owner)', owner, `/clubs/${ids.busy}/members`),
    await time('upcoming events', owner, `/clubs/${ids.busy}/events?scope=upcoming`),
    await time('past events, first page', owner, `/clubs/${ids.busy}/events/past`),
    await time(`who's going, first 8 of ${BIG_EVENT}`, owner, `/clubs/${ids.busy}/events/${ids.big}/registrations?limit=8`),
    await time('workspace join requests, pending', owner, `/orgs/${org.id}/join-requests`),
    await time('workspace join requests, declined', owner, `/orgs/${org.id}/join-requests?status=rejected`),
    await time('club join requests', owner, `/clubs/${ids.busy}/join-requests`),
    await time('activity log, first page', owner, `/orgs/${org.id}/audit`),
    await time('club attendance', owner, `/clubs/${ids.busy}/analytics`),
    await time('search', owner, `/search?q=past%20night%2042`),
    await time('your clubs (sidebar)', owner, `/orgs/${org.id}/clubs`),
    await time('Browse clubs', member, `/orgs/${org.id}/club-directory`),
  ];
  const slow = results.filter((ms) => ms > 300).length;
  console.log(slow ? `\n${slow} over 300 ms.` : '\nEverything under 300 ms.');
}

async function main() {
  const ds = await new DataSource({ type: 'postgres', url }).initialize();
  try {
    if (process.argv.includes('--reset') || process.argv.includes('--remove')) await remove(ds);
    if (process.argv.includes('--remove')) return console.log('Removed the load-test workspace.');
    const [org]: { id: string | null }[] = await ds.query(`SELECT org_id_for_slug($1) AS id`, [SLUG]);
    if (!org?.id) await build(ds);
    await measure(ds);
  } finally {
    await ds.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
