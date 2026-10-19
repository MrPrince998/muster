import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ticket types and discount codes. An event sells its places as types
 * ("General $15", "Members $10", "Early bird until 1 Nov", "Students, 10
 * of them"), any of which may be free; an event with none is free, as
 * before. Discount codes take a percentage or an amount off a paid type,
 * with an optional limit and end. Each place (and checkout, and waitlist
 * entry) records its type and code. Paid events become one type, "General
 * admission", at their price.
 */
export class TicketTypes1760000000018 implements MigrationInterface {
  name = 'TicketTypes1760000000018';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ticket_types (
        id            uuid         NOT NULL DEFAULT gen_random_uuid(),
        org_id        uuid         NOT NULL,
        event_id      uuid         NOT NULL,
        name          varchar(60)  NOT NULL,
        -- in the event's currency's smallest unit; 0: free
        price_cents   integer      NOT NULL,
        -- at most this many of this type (within the event's own capacity); null: no limit of its own
        capacity      integer,
        -- only for the club's members: not offered on the public page
        members_only  boolean      NOT NULL DEFAULT false,
        -- on sale until then (early bird); null: until the event
        sales_end_at  timestamptz,
        position      integer      NOT NULL DEFAULT 0,
        created_at    timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT ticket_types_pkey PRIMARY KEY (id),
        CONSTRAINT ticket_types_price_check CHECK (price_cents = 0 OR price_cents >= 50),
        CONSTRAINT ticket_types_capacity_check CHECK (capacity IS NULL OR capacity > 0),
        CONSTRAINT ticket_types_event_fkey FOREIGN KEY (event_id, org_id) REFERENCES events (id, org_id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX ticket_types_event_id_idx ON ticket_types (event_id, position)`);

    await queryRunner.query(`
      CREATE TABLE discount_codes (
        id                uuid         NOT NULL DEFAULT gen_random_uuid(),
        org_id            uuid         NOT NULL,
        event_id          uuid         NOT NULL,
        -- as typed people use it; kept upper-case, matched ignoring case
        code              varchar(30)  NOT NULL,
        percent_off       integer,
        amount_off_cents  integer,
        max_uses          integer,
        expires_at        timestamptz,
        active            boolean      NOT NULL DEFAULT true,
        created_by        uuid,
        created_at        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT discount_codes_pkey PRIMARY KEY (id),
        CONSTRAINT discount_codes_event_id_code_key UNIQUE (event_id, code),
        CONSTRAINT discount_codes_off_check CHECK (
          (percent_off IS NULL) <> (amount_off_cents IS NULL)
          AND (percent_off IS NULL OR percent_off BETWEEN 1 AND 100)
          AND (amount_off_cents IS NULL OR amount_off_cents > 0)),
        CONSTRAINT discount_codes_max_uses_check CHECK (max_uses IS NULL OR max_uses > 0),
        CONSTRAINT discount_codes_event_fkey FOREIGN KEY (event_id, org_id) REFERENCES events (id, org_id) ON DELETE CASCADE,
        CONSTRAINT discount_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      )
    `);

    for (const table of ['ticket_types', 'discount_codes']) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON ${table}
          USING (org_id = current_org_id())
          WITH CHECK (org_id = current_org_id())
      `);
    }

    for (const table of ['registrations', 'checkouts', 'waitlist_entries']) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD COLUMN ticket_type_id uuid,
          ADD CONSTRAINT ${table}_ticket_type_id_fkey FOREIGN KEY (ticket_type_id) REFERENCES ticket_types (id) ON DELETE RESTRICT
      `);
      await queryRunner.query(`CREATE INDEX ${table}_ticket_type_id_idx ON ${table} (ticket_type_id) WHERE ticket_type_id IS NOT NULL`);
    }
    for (const table of ['registrations', 'checkouts']) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD COLUMN discount_code_id uuid,
          ADD CONSTRAINT ${table}_discount_code_id_fkey FOREIGN KEY (discount_code_id) REFERENCES discount_codes (id) ON DELETE RESTRICT
      `);
      await queryRunner.query(`CREATE INDEX ${table}_discount_code_id_idx ON ${table} (discount_code_id) WHERE discount_code_id IS NOT NULL`);
    }

    // every paid event becomes one type at its price, and its places and checkouts that type
    await queryRunner.query(`
      INSERT INTO ticket_types (org_id, event_id, name, price_cents)
      SELECT org_id, id, 'General admission', price_cents FROM events WHERE price_cents IS NOT NULL
    `);
    for (const table of ['registrations', 'checkouts']) {
      await queryRunner.query(`
        UPDATE ${table} x SET ticket_type_id = t.id
        FROM ticket_types t WHERE t.event_id = x.event_id
      `);
    }
    await queryRunner.query(`
      ALTER TABLE events
        DROP CONSTRAINT events_currency_check,
        DROP CONSTRAINT events_price_check,
        DROP COLUMN price_cents
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE events ADD COLUMN price_cents integer`);
    await queryRunner.query(`
      UPDATE events e SET price_cents = (SELECT max(price_cents) FROM ticket_types t WHERE t.event_id = e.id AND price_cents > 0)
    `);
    await queryRunner.query(`UPDATE events SET currency = NULL WHERE price_cents IS NULL`);
    await queryRunner.query(`
      ALTER TABLE events
        ADD CONSTRAINT events_price_check CHECK (price_cents IS NULL OR price_cents >= 50),
        ADD CONSTRAINT events_currency_check CHECK ((price_cents IS NULL) = (currency IS NULL))
    `);
    for (const table of ['registrations', 'checkouts']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN discount_code_id`);
    }
    for (const table of ['registrations', 'checkouts', 'waitlist_entries']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN ticket_type_id`);
    }
    await queryRunner.query(`DROP TABLE discount_codes`);
    await queryRunner.query(`DROP TABLE ticket_types`);
  }
}
