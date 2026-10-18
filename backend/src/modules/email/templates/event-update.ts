import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

interface EventEmailBase {
  name: string;
  eventTitle: string;
  clubName: string;
  // the club's events in the app
  url: string;
}

export interface EventCancelledEmailData extends EventEmailBase {
  // as it was going to happen, for recognising which event this is
  when: string;
  // the organiser's note, if they left one
  reason: string | null;
}

/** Sent to everyone registered when the organisers call an event off. */
export function eventCancelledTemplate({
  name,
  eventTitle,
  clubName,
  when,
  reason,
  url,
}: EventCancelledEmailData): RenderedEmail {
  return renderActionEmail(`Cancelled: ${eventTitle}`, {
    preheader: `${clubName} has cancelled ${eventTitle}. Your ticket won't be needed.`,
    heading: `${eventTitle} is cancelled`,
    intro: [
      `Hi ${name},`,
      `${clubName} has cancelled ${eventTitle}, which was on ${when}.`,
      ...(reason ? [`They said: "${reason}"`] : []),
      "You don't need to do anything. Your ticket won't get anyone in now.",
    ],
    action: { label: 'See the event', url },
    footnote: [`You're getting this because you registered for ${eventTitle} in ${APP_NAME}.`],
  });
}

export interface EventChangedEmailData extends EventEmailBase {
  // the new details; `before` holds the old ones that changed
  when: string;
  where: string | null;
  before: { when?: string; where?: string | null };
}

/** Sent to everyone registered when the time or place of an event changes. */
export function eventChangedTemplate({
  name,
  eventTitle,
  clubName,
  when,
  where,
  before,
  url,
}: EventChangedEmailData): RenderedEmail {
  const moved = before.when !== undefined;
  const relocated = before.where !== undefined;
  const what = moved && relocated ? 'time and place' : moved ? 'time' : 'place';
  return renderActionEmail(`Changed: ${eventTitle}`, {
    preheader: `${clubName} has changed the ${what} of ${eventTitle}. Your ticket still works.`,
    heading: `${eventTitle} has a new ${what}`,
    intro: [
      `Hi ${name},`,
      `${clubName} has changed the ${what} of ${eventTitle}.`,
      ...(moved ? [`When: ${when} (was ${before.when})`] : [`When: ${when}`]),
      ...(relocated
        ? [`Where: ${where ?? 'to be announced'} (was ${before.where ?? 'not set'})`]
        : where
          ? [`Where: ${where}`]
          : []),
      "Your ticket still works. Can't make it now? Cancel your place so someone else can have it.",
    ],
    action: { label: 'Open the event', url },
    footnote: [`You're getting this because you registered for ${eventTitle} in ${APP_NAME}.`],
  });
}
