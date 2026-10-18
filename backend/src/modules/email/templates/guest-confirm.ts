import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

export interface GuestConfirmEmailData {
  name: string;
  eventTitle: string;
  clubName: string;
  when: string;
  url: string;
  // the event is full: confirming joins the waitlist instead
  waitlist?: boolean;
}

/**
 * A guest asked for a place: one click confirms it and sends the ticket. Until
 * then nothing is held, so a stranger typing your address can't spend a place
 * in your name (or fill the event with made-up ones).
 */
export function guestConfirmTemplate({ name, eventTitle, clubName, when, url, waitlist }: GuestConfirmEmailData): RenderedEmail {
  if (waitlist) {
    return renderActionEmail(`Join the waitlist: ${eventTitle}`, {
      preheader: `${eventTitle} is full. One click puts you on the waitlist.`,
      heading: 'Join the waitlist',
      intro: [
        `Hi ${name},`,
        `${eventTitle}, run by ${clubName}, is full right now.`,
        `When: ${when}`,
        "Confirm and you're on the waitlist. If a place opens up, it goes to whoever has waited longest, and your ticket arrives by email.",
      ],
      action: { label: 'Join the waitlist', url },
      footnote: [
        'The link works for 24 hours.',
        `Didn't ask for this? Ignore this email: nothing happens, and ${APP_NAME} won't email you again about it.`,
      ],
    });
  }
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
