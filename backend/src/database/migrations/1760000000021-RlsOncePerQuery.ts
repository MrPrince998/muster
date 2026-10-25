import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The same tenant isolation, evaluated once per query instead of once per
 * row. current_org_id() is a small STABLE SQL function, so Postgres inlines
 * it: every policy became `org_id = NULLIF(current_setting(...), '')::uuid`,
 * worked out again for each row read. Wrapped in a sub-select it runs once
 * (an InitPlan), and the comparison is against a constant, which indexes on
 * org_id can use. Who can see what doesn't change: the same 18 policies,
 * same names, same tables, same rule.
 */

// every tenant table, and the column its policy compares (organisations is the tenant itself)
const TABLES: [table: string, column: string][] = [
  ['organisations', 'id'],
  ['org_members', 'org_id'],
  ['org_join_requests', 'org_id'],
  ['clubs', 'org_id'],
  ['club_members', 'org_id'],
  ['roles', 'org_id'],
  ['member_roles', 'org_id'],
  ['invites', 'org_id'],
  ['join_requests', 'org_id'],
  ['events', 'org_id'],
  ['ticket_types', 'org_id'],
  ['discount_codes', 'org_id'],
  ['registrations', 'org_id'],
  ['checkouts', 'org_id'],
  ['waitlist_entries', 'org_id'],
  ['event_feedback', 'org_id'],
  ['event_messages', 'org_id'],
  ['audit_log', 'org_id'],
];

const policy = (table: string, column: string, orgId: string) => `
  DROP POLICY tenant_isolation ON ${table};
  CREATE POLICY tenant_isolation ON ${table}
    USING (${column} = ${orgId})
    WITH CHECK (${column} = ${orgId});`;

export class RlsOncePerQuery1760000000021 implements MigrationInterface {
  name = 'RlsOncePerQuery1760000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of TABLES) await queryRunner.query(policy(table, column, '(SELECT current_org_id())'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of TABLES) await queryRunner.query(policy(table, column, 'current_org_id()'));
  }
}
