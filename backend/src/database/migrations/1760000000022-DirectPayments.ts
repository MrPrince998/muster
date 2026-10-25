import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Paying the organisers directly: for workspaces Stripe can't serve (Nepal,
 * say) or that would rather not use it. The workspace says how to pay it
 * (eSewa, Khalti, a bank account, cash: its own words, and a QR code if it
 * has one) and in what currency; a buyer's place is held for a while, with
 * a short reference to put on the payment, until an organiser marks it paid.
 * Muster never holds the money either way.
 *
 * A workspace takes one or the other (payment_method); each checkout says
 * which it was, so switching doesn't strand anyone paying at the time.
 * direct_currency is apart from currency, which Stripe's webhooks keep in
 * step with the Stripe account.
 */
export class DirectPayments1760000000022 implements MigrationInterface {
  name = 'DirectPayments1760000000022';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organisations
        ADD COLUMN payment_method varchar(10) NOT NULL DEFAULT 'stripe',
        ADD COLUMN direct_currency varchar(3),
        ADD COLUMN direct_instructions varchar(1000),
        ADD COLUMN direct_qr_key varchar(100),
        -- how long a place waits for its payment
        ADD COLUMN direct_hold_hours smallint NOT NULL DEFAULT 48,
        ADD CONSTRAINT organisations_payment_method_check CHECK (payment_method IN ('stripe', 'direct')),
        ADD CONSTRAINT organisations_direct_hold_hours_check CHECK (direct_hold_hours BETWEEN 1 AND 168)
    `);
    await queryRunner.query(`
      ALTER TABLE checkouts
        ADD COLUMN method varchar(10) NOT NULL DEFAULT 'stripe',
        -- what the buyer puts on the payment, so the organisers can match it
        ADD COLUMN reference varchar(12),
        ADD CONSTRAINT checkouts_method_check CHECK (method IN ('stripe', 'direct')),
        DROP CONSTRAINT checkouts_status_check,
        ADD CONSTRAINT checkouts_status_check CHECK (status IN ('pending', 'paid', 'expired', 'refunded', 'declined'))
    `);
    // the organisers' list of payments to confirm
    await queryRunner.query(
      `CREATE INDEX checkouts_direct_pending_idx ON checkouts (event_id, created_at) WHERE method = 'direct' AND status = 'pending'`,
    );
    // paid to the organisers: refunds are theirs to make, not Stripe's
    await queryRunner.query(`ALTER TABLE registrations ADD COLUMN paid_directly boolean NOT NULL DEFAULT false`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE registrations DROP COLUMN paid_directly`);
    await queryRunner.query(`DROP INDEX checkouts_direct_pending_idx`);
    await queryRunner.query(`DELETE FROM checkouts WHERE method = 'direct'`);
    await queryRunner.query(`
      ALTER TABLE checkouts
        DROP CONSTRAINT checkouts_status_check,
        ADD CONSTRAINT checkouts_status_check CHECK (status IN ('pending', 'paid', 'expired', 'refunded')),
        DROP CONSTRAINT checkouts_method_check,
        DROP COLUMN reference,
        DROP COLUMN method
    `);
    await queryRunner.query(`
      ALTER TABLE organisations
        DROP CONSTRAINT organisations_direct_hold_hours_check,
        DROP CONSTRAINT organisations_payment_method_check,
        DROP COLUMN direct_hold_hours,
        DROP COLUMN direct_qr_key,
        DROP COLUMN direct_instructions,
        DROP COLUMN direct_currency,
        DROP COLUMN payment_method
    `);
  }
}
