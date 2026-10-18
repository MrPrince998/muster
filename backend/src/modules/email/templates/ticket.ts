import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

export interface TicketEmailData {
  name: string;
  eventTitle: string;
  clubName: string;
  // already formatted for the reader: "Saturday 24 October 2026, 18:30 to 22:00 (AEDT)"
  when: string;
  where: string | null;
  // the ticket page in the app, which shows the live QR code
  url: string;
  // the place came off the waitlist: say so, instead of "you're registered"
  fromWaitlist?: boolean;
}

/** Sent after registering; the QR code is attached as a PNG. */
export function ticketTemplate({ name, eventTitle, clubName, when, where, url, fromWaitlist }: TicketEmailData): RenderedEmail {
  return renderActionEmail(fromWaitlist ? `A place opened up: ${eventTitle}` : `Your ticket: ${eventTitle}`, {
    preheader: fromWaitlist
      ? `You're off the waitlist for ${eventTitle}. Your QR ticket is attached.`
      : `You're going to ${eventTitle}. Your QR ticket is attached and in the app.`,
    heading: `You're going to ${eventTitle}`,
    intro: [
      `Hi ${name},`,
      fromWaitlist
        ? `A place opened up at ${eventTitle} with ${clubName}, and it's yours: you were next on the waitlist.`
        : `You're registered for ${eventTitle} with ${clubName}.`,
      `When: ${when}`,
      ...(where ? [`Where: ${where}`] : []),
      'Show the QR code at the door to get in. It is attached to this email, and always in the app.',
    ],
    action: { label: 'Open your ticket', url },
    footnote: [
      'The ticket works once: it is checked in when it is scanned.',
      `Can't make it? Cancel your place in ${APP_NAME} so someone else can have it.`,
    ],
  });
}
