import type { TenantService } from '../../database/tenant.service.js';
import { SearchService } from './search.service.js';

const me = { id: 'u1', sessionId: 's1' };
const org = (orgId: string, name: string) => ({ orgId, name, slug: name.toLowerCase(), role: 'member', joinedAt: new Date() });
const hour = 3_600_000;

/**
 * Two workspaces, each with its own fake database: queries are answered by
 * SQL fragment, and every call records which workspace it ran in.
 */
function setup(answers: Record<string, [fragment: string, rows: unknown[]][]>) {
  const calls: { orgId: string; sql: string; params: unknown[] }[] = [];
  const tenant = {
    userOrganisations: vi.fn().mockResolvedValue([org('o1', 'CSU'), org('o2', 'UNSW')]),
    withTenant: vi.fn((orgId: string, work: (m: unknown) => unknown) =>
      work({
        query: vi.fn(async (sql: string, params: unknown[]) => {
          calls.push({ orgId, sql, params });
          return (answers[orgId] ?? []).find(([fragment]) => sql.includes(fragment))?.[1] ?? [];
        }),
      }),
    ),
  };
  return { service: new SearchService(tenant as unknown as TenantService), calls };
}

describe('SearchService', () => {
  it('escapes LIKE wildcards, so "50%_off" is searched literally', async () => {
    const { service, calls } = setup({});
    await service.search(me, '50%_off');
    expect(calls.find((c) => c.sql.includes('ILIKE'))!.params.slice(0, 4)).toEqual(['50%_off', '50\\%\\_off%', '% 50\\%\\_off%', '%50\\%\\_off%']);
  });

  it('searches every workspace you belong to, each in its own tenant, and merges by score', async () => {
    const { service, calls } = setup({
      o1: [['FROM clubs c', [{ id: 'c1', name: 'Robotics', score: 0.6 }]]],
      o2: [['FROM clubs c', [{ id: 'c2', name: 'Robotics Society', score: 1 }]]],
    });
    const result = await service.search(me, 'robo');
    expect(new Set(calls.map((c) => c.orgId))).toEqual(new Set(['o1', 'o2']));
    expect(result.clubs).toEqual([
      { id: 'c2', name: 'Robotics Society', orgName: 'UNSW', orgSlug: 'unsw' },
      { id: 'c1', name: 'Robotics', orgName: 'CSU', orgSlug: 'csu' },
    ]);
  });

  it("lists a workspace whose own name matches, with your role there", async () => {
    const { service } = setup({ o1: [['FROM organisations o', [{ score: 1 }]]] });
    const { workspaces } = await service.search(me, 'csu');
    expect(workspaces).toEqual([{ orgId: 'o1', name: 'CSU', slug: 'csu', role: 'member' }]);
  });

  it('puts equally good events that are still to come first, soonest first', async () => {
    const at = (h: number) => ({ starts_at: new Date(Date.now() + h * hour), ends_at: new Date(Date.now() + (h + 2) * hour), ended: h < 0 });
    const event = (id: string, h: number) => ({ id, title: 'Demo Night', status: 'published', club_id: 'c1', club_name: 'Robotics', score: 1, ...at(h) });
    const { service } = setup({
      o1: [['FROM events e', [event('past', -48), event('later', 72), event('soon', 24)]]],
    });
    const { events } = await service.search(me, 'demo');
    expect(events.map((e) => e.id)).toEqual(['soon', 'later', 'past']);
  });

  it('only offers drafts you could edit (the same rule as the event list)', async () => {
    const { service, calls } = setup({});
    await service.search(me, 'demo');
    const sql = calls.find((c) => c.sql.includes('FROM events e'))!.sql;
    expect(sql).toContain("e.status <> 'draft'");
    expect(sql).toContain("'event.manage_any' = ANY(mine.permissions)");
    expect(sql).toContain("'event.manage_own' = ANY(mine.permissions) AND e.created_by = $5");
  });

  it('keeps each kind short', async () => {
    const people = Array.from({ length: 5 }, (_, i) => ({ user_id: `p${i}`, name: `Ada ${i}`, role: 'member', score: 1 - i / 10 }));
    const { service } = setup({ o1: [['FROM org_members', people]], o2: [['FROM org_members', people]] });
    expect((await service.search(me, 'ada')).people).toHaveLength(5);
  });
});
