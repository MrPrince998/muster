import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Paid tickets, through Stripe Connect: each workspace connects its own
 * Stripe account (money goes there, not through Muster). An event with a
 * price sells its places through Stripe Checkout; while someone pays, a
 * checkout holds their place for half an hour, so the last seat can't be
 * sold twice. Paid places record what was paid and any refund.
 */
export class PaidTickets1760000000015 implements MigrationInterface {
  name = 'PaidTickets1760000000015';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organisations
        ADD COLUMN stripe_account_id varchar(64),
        -- Stripe says the account can take payments (onboarding finished)
        ADD COLUMN payments_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN currency varchar(3),
        ADD CONSTRAINT organisations_stripe_account_id_key UNIQUE (stripe_account_id)
    `);
    await queryRunner.query(`
      ALTER TABLE events
        -- in the currency's smallest unit (cents); null: free
        ADD COLUMN price_cents integer,
        ADD COLUMN currency varchar(3),
        -- a place given back at least this long before the start is refunded
        ADD COLUMN refund_cutoff_hours integer NOT NULL DEFAULT 48,
        ADD CONSTRAINT events_price_check CHECK (price_cents IS NULL OR price_cents >= 50),
        ADD CONSTRAINT events_currency_check CHECK ((price_cents IS NULL) = (currency IS NULL)),
        ADD CONSTRAINT events_refund_cutoff_check CHECK (refund_cutoff_hours >= 0)
    `);
    await queryRunner.query(`
      ALTER TABLE registrations
        ADD COLUMN amount_paid_cents integer,
        ADD COLUMN currency varchar(3),
        ADD COLUMN payment_intent_id varchar(255),
        ADD COLUMN refunded_at timestamptz,
        ADD CONSTRAINT registrations_payment_intent_id_key UNIQUE (payment_intent_id)
    `);

    await queryRunner.query(`
      CREATE TABLE checkouts (
        id              uuid         NOT NULL DEFAULT gen_random_uuid(),
        org_id          uuid         NOT NULL,
        event_id        uuid         NOT NULL,
        user_id         uuid         NOT NULL,
        session_id      varchar(255),
        url             text,
        amount_cents    integer      NOT NULL,
        currency        varchar(3)   NOT NULL,
        -- pending: holding a place while they pay; paid: the place is theirs;
        -- expired: they didn't pay in time; refunded: paid, but too late to keep
        status          varchar(10)  NOT NULL DEFAULT 'pending',
        expires_at      timestamptz  NOT NULL,
        registration_id uuid,
        created_at      timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT checkouts_pkey PRIMARY KEY (id),
        CONSTRAINT checkouts_session_id_key UNIQUE (session_id),
        CONSTRAINT checkouts_status_check CHECK (status IN ('pending', 'paid', 'expired', 'refunded')),
        CONSTRAINT checkouts_event_fkey FOREIGN KEY (event_id, org_id) REFERENCES events (id, org_id) ON DELETE CASCADE,
        CONSTRAINT checkouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);
    // the places held right now, per event
    await queryRunner.query(`CREATE INDEX checkouts_held_idx ON checkouts (event_id, expires_at) WHERE status = 'pending'`);
    await queryRunner.query(`ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE checkouts FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON checkouts
        USING (org_id = current_org_id())
        WITH CHECK (org_id = current_org_id())
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE checkouts`);
    await queryRunner.query(`
      ALTER TABLE registrations
        DROP CONSTRAINT registrations_payment_intent_id_key,
        DROP COLUMN refunded_at, DROP COLUMN payment_intent_id, DROP COLUMN currency, DROP COLUMN amount_paid_cents
    `);
    await queryRunner.query(`
      ALTER TABLE events
        DROP CONSTRAINT events_refund_cutoff_check, DROP CONSTRAINT events_currency_check, DROP CONSTRAINT events_price_check,
        DROP COLUMN refund_cutoff_hours, DROP COLUMN currency, DROP COLUMN price_cents
    `);
    await queryRunner.query(`
      ALTER TABLE organisations
        DROP CONSTRAINT organisations_stripe_account_id_key,
        DROP COLUMN currency, DROP COLUMN payments_enabled, DROP COLUMN stripe_account_id
    `);
  }
}
