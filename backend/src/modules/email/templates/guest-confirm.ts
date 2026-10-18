import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

export interface GuestConfirmEmailData {
  name: string;
  eventTitle: string;
  clubName: string;
  when: string;
  url: string;
}

/**
 * A guest asked for a place: one click confirms it and sends the ticket. Until
 * then nothing is held, so a stranger typing your address can't spend a place
 * in your name (or fill the event with made-up ones).
 */
export function guestConfirmTemplate({ name, eventTitle, clubName, when, url }: GuestConfirmEmailData): RenderedEmail {
  return renderActionEmail(`Confirm your place: ${eventTitle}`, {
    preheader: `One click and your ticket for ${eventTitle} is on its way.`,
    heading: 'Confirm your place',
    intro: [
      `Hi ${name},`,
      `You asked for a place at ${eventTitle}, run by ${clubName}.`,
      `When: ${when}`,
      'Confirm it and your ticket arrives straight away. Your place is only held once you do.',
    ],
    action: { label: 'Confirm my place', url },
    footnote: [
      'The link works for 24 hours.',
      `Didn't ask for this? Ignore this email: nothing happens, and ${APP_NAME} won't email you again about it.`,
    ],
  });
}
