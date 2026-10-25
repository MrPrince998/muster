import { randomInt } from 'node:crypto';
import type { EntityManager } from 'typeorm';

/**
 * Currencies a workspace can price tickets in when it's paid directly: ones
 * with cents (or paisa), as every price here is counted in hundredths.
 */
export const DIRECT_CURRENCIES = [
  'npr', 'inr', 'bdt', 'pkr', 'lkr', 'usd', 'eur', 'gbp', 'aud', 'cad', 'nzd', 'sgd', 'myr', 'php', 'zar', 'kes', 'ngn',
] as const;

// no 0/O or 1/I/L: read off a screen and typed into a wallet's remarks
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A payment's reference, like "K7P2QX": short enough to type into a wallet app. */
export function newReference(): string {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** What a buyer needs to pay the organisers: how much, how, with what reference, and by when. */
export interface DirectPayment {
  checkoutId: string;
  reference: string;
  amountCents: number;
  currency: string;
  ticketType: string | null;
  instructions: string;
  qrUrl: string | null;
  expiresAt: Date;
}

// one checkout's, from the row below (or the same fields as JSON, from the events query)
export interface DirectPaymentRow {
  id: string;
  reference: string;
  amount_cents: number;
  currency: string;
  ticket_type: string | null;
  instructions: string | null;
  qr_key: string | null;
  expires_at: Date | string;
}

export const toDirectPayment = (row: DirectPaymentRow): DirectPayment => ({
  checkoutId: row.id,
  reference: row.reference,
  amountCents: row.amount_cents,
  currency: row.currency,
  ticketType: row.ticket_type,
  instructions: row.instructions ?? '',
  qrUrl: row.qr_key ? `/files/${row.qr_key}` : null,
  expiresAt: new Date(row.expires_at),
});

/**
 * The columns of a direct payment, for json_build_object: `h` a checkout,
 * `o` its workspace, `t` its ticket type (left-joined).
 */
export const DIRECT_PAYMENT_FIELDS = `
  'id', h.id, 'reference', h.reference, 'amount_cents', h.amount_cents, 'currency', h.currency,
  'ticket_type', t.name, 'instructions', o.direct_instructions, 'qr_key', o.direct_qr_key, 'expires_at', h.expires_at`;

/** One checkout's payment details, inside the caller's tenant transaction. */
export async function directPayment(m: EntityManager, checkoutId: string): Promise<DirectPayment> {
  const [row]: { payment: DirectPaymentRow }[] = await m.query(
    `SELECT json_build_object(${DIRECT_PAYMENT_FIELDS}) AS payment
     FROM checkouts h JOIN organisations o ON o.id = h.org_id LEFT JOIN ticket_types t ON t.id = h.ticket_type_id
     WHERE h.id = $1`,
    [checkoutId],
  );
  return toDirectPayment(row.payment);
}
