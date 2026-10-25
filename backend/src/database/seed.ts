/**
 * Demo data (README: "Getting started"): two workspaces with clubs, members
 * in different roles, months of past events with attendance, and upcoming
 * ones covering every state an event can be in. Sign in as the demo user to
 * see all of it.
 *
 *   pnpm seed           creates it, unless it's there already
 *   pnpm seed --reset   deletes the demo data (and only that) and creates it again
 *
 * Every demo address is on the reserved .test domain, so no email is ever
 * sent to it. Refuses to run in production.
 *
 * Writes as the schema owner (MIGRATION_DATABASE_URL), each workspace inside
 * its own tenant (app.current_org_id), so row-level security is satisfied
 * whether or not the owner bypasses it. Clubs are made by ClubService, the
 * same code the app uses, so they get their Owner and default roles.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { PasswordHasher } from '@nestjs/authentication';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { ClubService } from '../modules/club/club.service.js';

const DOMAIN = 'muster.test';
const DEMO_EMAIL = `demo@${DOMAIN}`;
const ADMIN_EMAIL = `admin@${DOMAIN}`;
const production = process.env.NODE_ENV === 'production';

if (production && !process.argv.includes('--force')) {
  console.error('Refusing to seed demo data in production (pass --force if you really mean it).');
  process.exit(1);
}
// the documented password is fine on a laptop; on a public site anyone could sign in with it
if (production && (process.env.SEED_PASSWORD ?? '').length < 12) {
  console.error('In production, set SEED_PASSWORD (12 characters or more) for the demo accounts.');
  process.exit(1);
}
const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'demopassword123';
// development's pretend Stripe account: never on a real deployment, where it would break real payments
const PRETEND_STRIPE = !production;
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('Missing environment variable: MIGRATION_DATABASE_URL');

// --- a small seeded random, so every run makes the same demo ------------------

let state = 20261019;
function random(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
function sample<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

const DAY = 86_400_000;
// events happen at sensible times where the club is: the app's time zone
// (APP_TIME_ZONE, as emails use), not wherever this script runs
// (each workspace has its own: Riverside uses APP_TIME_ZONE, Northside is in Perth)
const RIVERSIDE_ZONE = process.env.APP_TIME_ZONE ?? 'UTC';
const NORTHSIDE_ZONE = 'Australia/Perth';
let ZONE = RIVERSIDE_ZONE;

// the zone's offset from UTC at that moment, in minutes ("GMT+11:00" -> 660)
function offsetMinutes(at: number): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'longOffset' })
      .formatToParts(new Date(at))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

/** That many days from today, at hour:minute on the clock in ZONE. */
function daysFromNow(days: number, hour = 18, minute = 30): Date {
  const day = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(Date.now() + days * DAY))
      .map((part) => [part.type, part.value]),
  );
  const wallClock = Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day), hour, minute);
  return new Date(wallClock - offsetMinutes(wallClock) * 60_000);
}
const hoursAfter = (date: Date, hours: number) => new Date(date.getTime() + hours * 3_600_000);

// --- people -------------------------------------------------------------------

const FIRST = ['Ada', 'Priya', 'Marcus', 'Lena', 'Tomás', 'Aisha', 'Jordan', 'Mei', 'Oliver', 'Zara', 'Kai', 'Noah', 'Sofia', 'Ravi', 'Hannah', 'Leo', 'Amara', 'Ethan', 'Yuki', 'Isla', 'Mateo', 'Chloe', 'Arjun', 'Grace', 'Samir', 'Ruby', 'Felix', 'Nadia', 'Theo', 'Leila', 'Owen', 'Ines', 'Daniel', 'Maya', 'Hugo', 'Freya', 'Kofi', 'Elena', 'Jack', 'Anika', 'Liam', 'Rosa', 'Ben', 'Hana'];
const LAST = ['Okafor', 'Sharma', 'Bennett', 'Kowalski', 'García', 'Rahman', 'Lee', 'Chen', 'Walsh', 'Ahmed', 'Nguyen', 'Brooks', 'Rossi', 'Patel', 'Müller', 'Martin', 'Diallo', 'Cohen', 'Tanaka', 'Fraser', 'Silva', 'Dubois', 'Iyer', 'O’Brien', 'Haddad', 'Clarke', 'Novak', 'Petrov', 'Kim', 'Moreau'];

interface Person {
  id: string;
  name: string;
  email: string;
}

const slugify = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.');

async function makePeople(ds: DataSource, passwordHash: string) {
  const insert = async (name: string, email: string, hash: string | null, joinedDaysAgo: number): Promise<Person> => {
    const [row]: { id: string }[] = await ds.query(
      `INSERT INTO users (email, name, password_hash, email_verified_at, created_at)
       VALUES ($1, $2, $3, $4, now() - make_interval(days => $5)) RETURNING id`,
      [email, name, hash, hash ? new Date(Date.now() - joinedDaysAgo * DAY) : null, joinedDaysAgo],
    );
    return { id: row.id, name, email };
  };

  const demo = await insert('Sam Rivera', DEMO_EMAIL, passwordHash, 400);
  const used = new Set<string>();
  const members: Person[] = [];
  while (members.length < 44) {
    const name = `${FIRST[members.length]} ${LAST[between(0, LAST.length - 1)]}`;
    if (used.has(name)) continue;
    used.add(name);
    members.push(await insert(name, `${slugify(name)}@${DOMAIN}`, passwordHash, between(30, 380)));
  }
  // registered for public events from outside, without accounts
  const guests: Person[] = [];
  for (const name of ['Wren Hale', 'Dev Malik', 'Lucia Ferro', 'Tom Ashby', 'Bea Lund', 'Ivo Kral']) {
    guests.push(await insert(name, `${slugify(name)}@guests.${DOMAIN}`, null, 60));
  }
  // asking to join Riverside, not in yet
  const applicants: Person[] = [];
  for (const name of ['Nora Quinn', 'Eli Watts']) {
    applicants.push(await insert(name, `${slugify(name)}@${DOMAIN}`, passwordHash, 5));
  }
  const northsideOwner = await insert('Alex Chen', `alex.chen@${DOMAIN}`, passwordHash, 300);
  // Riverside's workspace admin: manages members and settings, runs Robotics with the owner
  const admin = await insert('Avery Admin', ADMIN_EMAIL, passwordHash, 380);
  return { demo, members, guests, applicants, northsideOwner, admin };
}

// --- one workspace, in its own tenant -------------------------------------------

type Tx = EntityManager;

function inTenant<T>(ds: DataSource, orgId: string, work: (m: Tx) => Promise<T>): Promise<T> {
  return ds.transaction(async (m) => {
    await m.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    return work(m);
  });
}

interface Club {
  id: string;
  roles: Record<'Owner' | 'Admin' | 'Organizer' | 'Scanner' | 'Member', string>;
}

async function makeClub(
  m: Tx,
  orgId: string,
  club: { name: string; slug: string; description: string; owner: Person; isDefault?: boolean },
): Promise<Club> {
  const { clubId } = await new ClubService().provision(m, {
    orgId,
    name: club.name,
    slug: club.slug,
    description: club.description,
    isDefault: club.isDefault ?? false,
    ownerId: club.owner.id,
  });
  const rows: { id: string; name: string }[] = await m.query(`SELECT id, name FROM roles WHERE club_id = $1`, [clubId]);
  return { id: clubId, roles: Object.fromEntries(rows.map((r) => [r.name, r.id])) as Club['roles'] };
}

async function join(m: Tx, orgId: string, club: Club, people: Person[], role: keyof Club['roles'] | null = 'Member') {
  for (const person of people) {
    await m.query(`INSERT INTO club_members (club_id, user_id, org_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
      club.id,
      person.id,
      orgId,
    ]);
    if (role) {
      await m.query(
        `INSERT INTO member_roles (club_id, user_id, role_id, org_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [club.id, person.id, club.roles[role], orgId],
      );
    }
  }
}

interface EventPlan {
  title: string;
  description?: string;
  location: string;
  start: Date;
  hours?: number;
  capacity?: number | null;
  visibility?: 'members' | 'public';
  status?: 'draft' | 'published' | 'cancelled';
  cancelReason?: string;
  registrationClosed?: boolean;
  // who holds places, and (for past events) roughly what share came
  going: Person[];
  turnout?: number;
  waiting?: Person[];
  // one of a recurring series
  series?: { id: string; every: 'week' | 'fortnight' | 'month' };
  // ticket types (prices in AUD cents) and discount codes; none: free
  tickets?: { name: string; priceCents: number; membersOnly?: boolean; capacity?: number }[];
  codes?: { code: string; percentOff: number; maxUses?: number }[];
  // what it asks people taking a place (event/questions.ts)
  questions?: { id: string; label: string; kind: 'text' | 'choice'; options: string[]; required: boolean }[];
}

async function makeEvent(m: Tx, orgId: string, clubId: string, by: Person, plan: EventPlan) {
  const status = plan.status ?? 'published';
  const end = hoursAfter(plan.start, plan.hours ?? 3);
  const [{ id }]: { id: string }[] = await m.query(
    `INSERT INTO events (org_id, club_id, created_by, title, description, location, starts_at, ends_at, capacity,
                         visibility, status, published_at, cancelled_at, cancel_reason, registration_closed_at,
                         series_id, repeat_every, currency, questions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
    [
      orgId,
      clubId,
      by.id,
      plan.title,
      plan.description ?? null,
      plan.location,
      plan.start,
      end,
      plan.capacity ?? null,
      plan.visibility ?? 'members',
      status,
      status === 'draft' ? null : new Date(plan.start.getTime() - 21 * DAY),
      status === 'cancelled' ? new Date(Date.now() - 2 * DAY) : null,
      status === 'cancelled' ? (plan.cancelReason ?? null) : null,
      plan.registrationClosed ? new Date(Date.now() - DAY) : null,
      plan.series?.id ?? null,
      plan.series?.every ?? null,
      plan.tickets?.some((t) => t.priceCents > 0) ? 'aud' : null,
      JSON.stringify(plan.questions ?? []),
    ],
  );
  for (const [position, t] of (plan.tickets ?? []).entries()) {
    await m.query(
      `INSERT INTO ticket_types (org_id, event_id, name, price_cents, members_only, capacity, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, id, t.name, t.priceCents, !!t.membersOnly, t.capacity ?? null, position],
    );
  }
  for (const c of plan.codes ?? []) {
    await m.query(
      `INSERT INTO discount_codes (org_id, event_id, code, percent_off, max_uses, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [orgId, id, c.code, c.percentOff, c.maxUses ?? null, by.id],
    );
  }
  const over = end.getTime() < Date.now();
  for (const person of plan.going) {
    const came = over && random() < (plan.turnout ?? 0.8);
    await m.query(
      `INSERT INTO registrations (org_id, event_id, user_id, checked_in_at, checked_in_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orgId,
        id,
        person.id,
        came ? new Date(plan.start.getTime() + between(-10, 45) * 60_000) : null,
        came ? by.id : null,
        new Date(Math.min(Date.now(), plan.start.getTime()) - between(2, 20) * DAY),
      ],
    );
  }
  for (const [i, person] of (plan.waiting ?? []).entries()) {
    await m.query(`INSERT INTO waitlist_entries (org_id, event_id, user_id, created_at) VALUES ($1, $2, $3, $4)`, [
      orgId,
      id,
      person.id,
      new Date(Date.now() - (5 - i) * DAY),
    ]);
  }
  if (over && status === 'published') {
    // everyone who came was asked how it went; about two in three answered, mostly happily
    // (worked out in SQL from each place's id, so the random draws above stay as they were)
    await m.query(`UPDATE registrations SET feedback_requested_at = $2 WHERE event_id = $1`, [id, end]);
    await m.query(
      `INSERT INTO event_feedback (org_id, event_id, registration_id, rating, comment, created_at, updated_at)
       SELECT org_id, event_id, id,
              (ARRAY[5, 4, 5, 3, 4, 5, 2, 4])[1 + abs(hashtext(id::text)) % 8],
              (ARRAY['Really well run, thank you!', NULL, 'Could have used a bigger room.', NULL, NULL,
                     'Loved it. More of these please.', NULL, 'Started a bit late.'])[1 + abs(hashtext(id::text || 'c')) % 8],
              $2, $2
       FROM registrations
       WHERE event_id = $1 AND checked_in_at IS NOT NULL AND abs(hashtext(id::text)) % 3 <> 0`,
      [id, new Date(end.getTime() + 20 * 3_600_000)],
    );
  }
  return id;
}

// --- the demo -------------------------------------------------------------------

async function riverside(ds: DataSource, people: Awaited<ReturnType<typeof makePeople>>) {
  ZONE = RIVERSIDE_ZONE;
  const { demo, members, guests, applicants, admin } = people;
  // members are named in FIRST's order: Ada, Priya, Marcus, ...
  const [, priya, marcus] = members;
  const orgId = randomUUID();
  await inTenant(ds, orgId, async (m) => {
    await m.query(
      // its Stripe account is a pretend one, in development only: it sells tickets where PAYMENTS_FAKE is on
      `INSERT INTO organisations (id, name, slug, join_policy, time_zone, created_at, stripe_account_id, payments_enabled, currency)
       VALUES ($1, 'Riverside University', 'riverside-uni', 'request', $2, now() - interval '400 days', $3, $4, 'aud')`,
      [orgId, RIVERSIDE_ZONE, PRETEND_STRIPE ? 'acct_demo_riverside' : null, PRETEND_STRIPE],
    );
    await m.query(`INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now() - interval '400 days')`, [
      orgId,
      demo.id,
    ]);
    for (const [i, person] of members.entries()) {
      await m.query(`INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, $3, now() - make_interval(days => $4))`, [
        orgId,
        person.id,
        i === 1 ? 'admin' : i === 2 ? 'moderator' : 'member',
        between(20, 380),
      ]);
    }
    await m.query(`INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', now() - interval '380 days')`, [
      orgId,
      admin.id,
    ]);

    // everyone's in General; you run Robotics, help run Film, and just go to Hiking
    const general = await makeClub(m, orgId, {
      name: 'General',
      slug: 'general',
      description: 'Everyone at Riverside. Socials, welcome week and the AGM.',
      owner: demo,
      isDefault: true,
    });
    await join(m, orgId, general, [...members, admin]);
    const robotics = await makeClub(m, orgId, {
      name: 'Robotics Society',
      slug: 'robotics',
      description: 'Build robots, break robots, fix robots. Every second Thursday.',
      owner: demo,
    });
    const roboticsCrew = members.slice(0, 24);
    await join(m, orgId, robotics, [priya, admin], 'Admin');
    await join(m, orgId, robotics, roboticsCrew.slice(2, 5), 'Organizer');
    await join(m, orgId, robotics, roboticsCrew.slice(5, 7), 'Scanner');
    await join(m, orgId, robotics, roboticsCrew.slice(7));
    const film = await makeClub(m, orgId, {
      name: 'Film Club',
      slug: 'film',
      description: 'A film a fortnight, and arguments about it after.',
      owner: priya,
    });
    await join(m, orgId, film, [demo], 'Admin');
    await join(m, orgId, film, sample(members.slice(1), 17));
    const hiking = await makeClub(m, orgId, {
      name: 'Hiking Club',
      slug: 'hiking',
      description: 'Day walks most weekends, a camping trip each term.',
      owner: marcus,
    });
    await join(m, orgId, hiking, [demo]);
    await join(m, orgId, hiking, sample(members.filter((p) => p !== marcus), 14));

    // Robotics: a season of history, and every kind of upcoming event
    const pastRobotics = [
      ['Welcome Night', 40, 0.82],
      ['Arduino Basics', 20, 0.9],
      ['Build-a-Bot Weekend', 30, 0.7],
      ['Sensor Lab', 15, 0.88],
      ['Line Follower Race', null, 0.8],
      ['Soldering 101', 12, 0.75],
      ['Demo Night', 50, 0.72],
      ['Drone Intro', 20, 0.86],
    ] as const;
    for (const [i, [title, capacity, turnout]] of pastRobotics.entries()) {
      const isPublic = i % 3 === 2;
      // guests at a public event take places too: the crowd never outgrows the capacity
      const guestCount = isPublic ? 3 : 0;
      const crowd = sample([demo, ...roboticsCrew], (capacity ? capacity - between(0, 6) : between(20, 26)) - guestCount);
      await makeEvent(m, orgId, robotics.id, demo, {
        title,
        location: i % 2 ? 'Engineering Lab 2' : 'Engineering Hall B',
        start: daysFromNow(-(8 - i) * 32 - between(0, 6)),
        capacity,
        visibility: isPublic ? 'public' : 'members',
        going: [...crowd, ...sample(guests, guestCount)],
        turnout,
      });
    }
    await makeEvent(m, orgId, robotics.id, demo, {
      title: 'Robot Wars Viewing',
      description: 'The new series on the big screen, with pizza. Bring a friend: this one is open to everyone.',
      location: 'Lecture Theatre 1',
      start: daysFromNow(5, 19),
      capacity: 60,
      visibility: 'public',
      going: [demo, ...sample(roboticsCrew, 18), ...sample(guests, 2)],
    });
    const soldering = sample(roboticsCrew.slice(7), 15);
    await makeEvent(m, orgId, robotics.id, demo, {
      title: 'Soldering Workshop',
      description: 'Twelve stations, so twelve places. Join the waitlist if it is full.',
      location: 'Engineering Lab 2',
      start: daysFromNow(9),
      capacity: 12,
      going: soldering.slice(0, 12),
      waiting: soldering.slice(12),
    });
    // a weekly series: the same evening for six weeks, each with its own places
    // (no sample(): the random draws after this stay as they were)
    const buildNights = { id: randomUUID(), every: 'week' as const };
    for (let week = 0; week < 6; week++) {
      await makeEvent(m, orgId, robotics.id, demo, {
        title: 'Build Night',
        description: 'Bring a project, or help with the club robot. Tools and snacks provided.',
        location: 'Engineering Lab 2',
        start: daysFromNow(3 + 7 * week, 18),
        capacity: 30,
        going: roboticsCrew.slice(0, [11, 7, 4, 0, 0, 0][week]),
        series: buildNights,
      });
    }
    // a paid one: the end-of-year dinner (nobody yet: tickets go on sale)
    await makeEvent(m, orgId, robotics.id, demo, {
      title: 'Robotics Gala Dinner',
      description: 'Three courses and the year in robots. Tickets cover dinner; refunds up to two days before.',
      location: 'The Boathouse',
      start: daysFromNow(24, 19),
      hours: 4,
      capacity: 40,
      visibility: 'public',
      tickets: [
        { name: 'Members', priceCents: 3500, membersOnly: true },
        { name: 'General', priceCents: 4500 },
      ],
      codes: [{ code: 'ROBOT10', percentOff: 10, maxUses: 20 }],
      questions: [
        { id: 'diet', label: 'Dietary needs', kind: 'choice', options: ['None', 'Vegetarian', 'Vegan', 'Gluten free'], required: true },
        { id: 'note', label: 'Anything the kitchen should know?', kind: 'text', options: [], required: false },
      ],
      going: [],
    });
    await makeEvent(m, orgId, robotics.id, demo, {
      title: 'Drone Race',
      location: 'Sports Field',
      start: daysFromNow(12, 14),
      capacity: 25,
      status: 'cancelled',
      cancelReason: 'The field is being resurfaced. We will pick a new date soon.',
      going: sample(roboticsCrew, 9),
    });
    await makeEvent(m, orgId, robotics.id, demo, {
      title: 'Summer Hackathon',
      description: 'Draft: 24 hours, teams of four. Dates to confirm with the department.',
      location: 'Engineering Hall B',
      start: daysFromNow(45, 10),
      hours: 24,
      capacity: 48,
      status: 'draft',
      going: [],
    });

    // Film: you help run it
    for (const [i, title] of ['Spirited Away', 'Paris, Texas', 'Parasite', 'Arrival', 'Amélie'].entries()) {
      await makeEvent(m, orgId, film.id, priya, {
        title,
        location: 'Media Room',
        start: daysFromNow(-(5 - i) * 21 - 3, 19),
        hours: 2.5,
        capacity: 30,
        going: sample([demo, ...members.slice(1, 30)], between(14, 26)),
        turnout: 0.78,
      });
    }
    await makeEvent(m, orgId, film.id, priya, {
      title: 'Studio Ghibli Night',
      location: 'Media Room',
      start: daysFromNow(3, 19),
      hours: 4,
      capacity: 30,
      going: [demo, ...sample(members.slice(1, 30), 21)],
    });
    await makeEvent(m, orgId, film.id, priya, {
      title: 'Short Film Showcase',
      description: 'Members show their own shorts. Anyone can come and vote.',
      location: 'Lecture Theatre 2',
      start: daysFromNow(16, 18),
      visibility: 'public',
      going: sample(members, 11),
    });

    // Hiking: you're a member here, nothing more
    for (const [i, title] of ['Ridge Walk', 'Waterfall Loop', 'Coastal Path', 'Night Hike'].entries()) {
      await makeEvent(m, orgId, hiking.id, marcus, {
        title,
        location: 'Meet at the North Gate',
        start: daysFromNow(-(4 - i) * 40, 8, 0),
        hours: 6,
        capacity: 20,
        going: sample([demo, ...members.slice(2)], between(10, 19)),
        turnout: 0.85,
      });
    }
    await makeEvent(m, orgId, hiking.id, marcus, {
      title: 'Sunrise Hike',
      location: 'Meet at the North Gate',
      start: daysFromNow(7, 5, 30),
      hours: 4,
      capacity: 20,
      going: sample(members.slice(2), 13),
    });

    // General
    await makeEvent(m, orgId, general.id, demo, {
      title: 'Welcome Back Social',
      location: 'Student Union Bar',
      start: daysFromNow(-50, 18),
      capacity: 80,
      going: sample([demo, ...members], 62),
      turnout: 0.74,
    });
    await makeEvent(m, orgId, general.id, demo, {
      title: 'Committee AGM',
      description: 'Elections for next year, and the budget. Registration closes when the agenda is final.',
      location: 'Room 4.12',
      start: daysFromNow(25, 17),
      hours: 2,
      registrationClosed: true,
      going: sample(members, 16),
    });

    // invite links: one open, one that needs approval (with people waiting on it)
    await m.query(
      `INSERT INTO invites (org_id, club_id, code, default_role_id, max_uses, use_count, created_by, expires_at)
       VALUES ($1, $2, $3, $4, 25, 7, $5, now() + interval '20 days')`,
      [orgId, robotics.id, randomBytes(16).toString('base64url'), robotics.roles.Member, demo.id],
    );
    const [{ id: approvalInvite }]: { id: string }[] = await m.query(
      `INSERT INTO invites (org_id, club_id, code, default_role_id, requires_approval, created_by)
       VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
      [orgId, robotics.id, randomBytes(16).toString('base64url'), robotics.roles.Member, demo.id],
    );
    for (const person of members.slice(30, 32)) {
      await m.query(
        `INSERT INTO join_requests (org_id, club_id, invite_id, user_id, created_at) VALUES ($1, $2, $3, $4, now() - interval '1 day')`,
        [orgId, robotics.id, approvalInvite, person.id],
      );
    }
    // each club's own join setting: Robotics asks (one person has, from Browse clubs),
    // Hiking lets anyone in, Film is invite links only; and an open club you're not in yet
    await m.query(`UPDATE clubs SET join_policy = 'request' WHERE id = $1`, [robotics.id]);
    await m.query(`UPDATE clubs SET join_policy = 'open' WHERE id = $1`, [hiking.id]);
    await m.query(
      `INSERT INTO join_requests (org_id, club_id, user_id, message, created_at) VALUES ($1, $2, $3, $4, now() - interval '3 hours')`,
      [orgId, robotics.id, members[32].id, 'I did FIRST Robotics at school and want to help with the line follower.'],
    );
    const chess = await makeClub(m, orgId, {
      name: 'Chess Club',
      slug: 'chess',
      description: 'Casual games on Tuesday evenings, and a term tournament. All levels.',
      owner: members[36],
    });
    await m.query(`UPDATE clubs SET join_policy = 'open' WHERE id = $1`, [chess.id]);
    await join(m, orgId, chess, members.slice(34, 44).filter((p) => p !== members[36]));
    // and two people asking to join the workspace itself
    for (const [i, person] of applicants.entries()) {
      await m.query(
        `INSERT INTO org_join_requests (org_id, user_id, message, created_at) VALUES ($1, $2, $3, now() - make_interval(hours => $4))`,
        [orgId, person.id, i === 0 ? "I'm a new postgrad in engineering and would love to join Robotics." : null, 6 + i * 20],
      );
    }
  });
}

async function northside(ds: DataSource, people: Awaited<ReturnType<typeof makePeople>>) {
  // a makerspace on the other side of the country: its times are Perth's
  ZONE = NORTHSIDE_ZONE;
  const { demo, members, northsideOwner: alex } = people;
  const orgId = randomUUID();
  const crowd = members.slice(20, 32);
  await inTenant(ds, orgId, async (m) => {
    await m.query(
      `INSERT INTO organisations (id, name, slug, join_policy, time_zone, created_at) VALUES ($1, 'Northside Makers', 'northside-makers', 'open', $2, now() - interval '300 days')`,
      [orgId, NORTHSIDE_ZONE],
    );
    await m.query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [orgId, alex.id]);
    for (const person of [demo, ...crowd]) {
      await m.query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member')`, [orgId, person.id]);
    }
    const general = await makeClub(m, orgId, {
      name: 'General',
      slug: 'general',
      description: 'The makerspace on Northside Road.',
      owner: alex,
      isDefault: true,
    });
    await join(m, orgId, general, [demo, ...crowd]);
    const printing = await makeClub(m, orgId, {
      name: '3D Printing Guild',
      slug: '3d-printing',
      description: 'Printers, filament and patience.',
      owner: alex,
    });
    await join(m, orgId, printing, [demo, ...crowd.slice(0, 8)]);
    for (const [i, title] of ['Open Workshop', 'Repair Café', 'Printer Tune-up'].entries()) {
      await makeEvent(m, orgId, printing.id, alex, {
        title,
        location: 'Unit 4, Northside Road',
        start: daysFromNow(-(3 - i) * 30, 10, 0),
        capacity: 15,
        going: sample([demo, ...crowd], between(8, 13)),
        turnout: 0.8,
      });
    }
    await makeEvent(m, orgId, printing.id, alex, {
      title: 'Print Your First Part',
      description: 'A beginners session: bring an idea, leave with a part.',
      location: 'Unit 4, Northside Road',
      start: daysFromNow(11, 10, 0),
      capacity: 10,
      visibility: 'public',
      going: sample(crowd, 6),
    });
  });
}

// --- run ----------------------------------------------------------------------------

async function removeDemo(ds: DataSource): Promise<void> {
  const orgs: { org_id: string }[] = await ds.query(
    `SELECT id AS org_id FROM organisations WHERE slug IN ('riverside-uni', 'northside-makers')`,
  );
  for (const { org_id } of orgs) {
    // only ever a demo workspace: one whose owner is a demo account
    const [owner]: { email: string }[] = await inTenant(ds, org_id, (m) =>
      m.query(
        `SELECT u.email FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = $1 AND om.role = 'owner'`,
        [org_id],
      ),
    );
    if (!owner?.email.endsWith(`@${DOMAIN}`)) {
      throw new Error(`A workspace with a demo slug belongs to ${owner?.email ?? 'nobody'}: not touching it.`);
    }
    await inTenant(ds, org_id, (m) => m.query(`DELETE FROM organisations WHERE id = $1`, [org_id]));
  }
  await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`%${DOMAIN}`]);
}

async function main() {
  const ds = await new DataSource({ type: 'postgres', url }).initialize();
  try {
    const [{ exists }]: { exists: boolean }[] = await ds.query(`SELECT EXISTS (SELECT 1 FROM users WHERE email = $1) AS exists`, [
      DEMO_EMAIL,
    ]);
    if (exists && !process.argv.includes('--reset')) {
      console.log(`The demo data is already there. Sign in as ${DEMO_EMAIL}${production ? '' : ` / ${DEMO_PASSWORD}`}`);
      console.log('Run `pnpm seed --reset` to delete it and create it afresh.');
      return;
    }
    if (exists) {
      await removeDemo(ds);
      console.log('Removed the previous demo data.');
    }

    // one hash for every demo account: scrypt is slow on purpose
    const passwordHash = await new PasswordHasher().hash(DEMO_PASSWORD);
    const people = await makePeople(ds, passwordHash);
    await riverside(ds, people);
    await northside(ds, people);

    // the password isn't printed in production: it's the one you set
    const password = production ? '(your SEED_PASSWORD)' : DEMO_PASSWORD;
    console.log('Demo data ready.');
    console.log(`  Owner:           ${DEMO_EMAIL} / ${password}`);
    console.log(`  Workspace admin: ${ADMIN_EMAIL} / ${password}`);
    console.log(`  Riverside University (you own it, ${RIVERSIDE_ZONE}) and Northside Makers (you are a member, ${NORTHSIDE_ZONE}).`);
    console.log(`  Every other demo account has the same password; all addresses end in @${DOMAIN}.`);
  } finally {
    await ds.destroy();
  }
}

await main();
