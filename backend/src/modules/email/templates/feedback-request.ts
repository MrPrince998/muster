import { renderActionEmail, type RenderedEmail } from './layout.js';

export interface FeedbackRequestEmailData {
  name: string;
  eventTitle: string;
  clubName: string;
  url: string;
}

/** The day after: one question, for the people who came. */
export function feedbackRequestTemplate({ name, eventTitle, clubName, url }: FeedbackRequestEmailData): RenderedEmail {
  return renderActionEmail(`How was ${eventTitle}?`, {
    preheader: `One question for ${clubName}: how was it?`,
    heading: `How was ${eventTitle}?`,
    intro: [
      `Hi ${name},`,
      `Thanks for coming. ${clubName} would like to know how it went: a rating out of five, and a few words if you like.`,
    ],
    action: { label: 'Rate it', url },
    footnote: [`${clubName} sees your rating and comment, but not your name. We only ask once per event.`],
  });
}
