import { renderActionEmail, type RenderedEmail } from './layout.js';
import type { TicketEmailData } from './ticket.js';

/** The day before: when and where, the ticket again, and a way out. */
export function reminderTemplate({ name, eventTitle, clubName, when, where, url }: TicketEmailData): RenderedEmail {
  return renderActionEmail(`Coming up: ${eventTitle}`, {
    preheader: `${eventTitle} is coming up. Your ticket is attached.`,
    heading: `${eventTitle} is coming up`,
    intro: [
      `Hi ${name},`,
      `A reminder that you're going to ${eventTitle} with ${clubName}.`,
      `When: ${when}`,
      ...(where ? [`Where: ${where}`] : []),
      'Your ticket is attached, and always in the app. Show the QR code at the door.',
    ],
    action: { label: 'Open your ticket', url },
    footnote: ["Can't make it after all? Give your place back from your ticket, so someone else can have it."],
  });
}
