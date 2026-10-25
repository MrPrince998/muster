import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

export interface PayDirectlyEmailData {
  name: string;
  eventTitle: string;
  clubName: string;
  when: string;
  // "NPR 500.00"
  amount: string;
  // the organisers' own words: eSewa ID, bank account, cash at the door
  instructions: string;
  reference: string;
  // "Saturday 24 October, 18:30 (NPT)"
  heldUntil: string;
  // the QR code goes with it, as an attachment
  hasQr: boolean;
  url: string;
}

/**
 * A place held while someone pays the organisers directly: how much, how,
 * the reference to put on it, and how long the place waits. The ticket
 * follows once an organiser marks it paid.
 */
export function payDirectlyTemplate(data: PayDirectlyEmailData): RenderedEmail {
  return renderActionEmail(`Pay for your ticket: ${data.eventTitle}`, {
    preheader: `Pay ${data.amount} to ${data.clubName} with reference ${data.reference}, and your ticket follows.`,
    heading: 'Pay for your ticket',
    intro: [
      `Hi ${data.name},`,
      `Your place at ${data.eventTitle}, run by ${data.clubName}, is held for you.`,
      `When: ${data.when}`,
      `Pay ${data.amount} to the organisers:`,
      ...data.instructions.split(/\n+/).map((line) => line.trim()).filter(Boolean),
      ...(data.hasQr ? ['Their payment QR code is attached.'] : []),
      `Put this reference on the payment: ${data.reference}`,
      `Your place is held until ${data.heldUntil}. Once the organisers see your payment, your ticket arrives by email.`,
    ],
    action: { label: 'See the event', url: data.url },
    footnote: [`${APP_NAME} doesn't take this payment: it goes straight to the organisers, and any refund is theirs to make.`],
  });
}

export interface PaymentDeclinedEmailData {
  name: string;
  eventTitle: string;
  clubName: string;
  reference: string;
  url: string;
}

/** The organisers couldn't find someone's payment, so the place they held is on offer again. */
export function paymentDeclinedTemplate(data: PaymentDeclinedEmailData): RenderedEmail {
  return renderActionEmail(`Your payment wasn't confirmed: ${data.eventTitle}`, {
    preheader: `The organisers of ${data.eventTitle} couldn't confirm your payment.`,
    heading: "Your payment wasn't confirmed",
    intro: [
      `Hi ${data.name},`,
      `The organisers of ${data.eventTitle}, run by ${data.clubName}, couldn't confirm your payment (reference ${data.reference}), so the place they held for you is on offer again.`,
      'If you did pay, get in touch with them and give them the reference.',
    ],
    action: { label: 'See the event', url: data.url },
    footnote: [`${APP_NAME} doesn't take these payments: they go straight to the organisers.`],
  });
}
