import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

export interface EventMessageEmailData {
  name: string;
  senderName: string;
  clubName: string;
  eventTitle: string;
  when: string;
  subject: string;
  // the organiser's words; a blank line starts a new paragraph
  body: string;
  // they're on the waitlist, not going (yet)
  waiting: boolean;
  url: string;
}

/** An organiser's message to everyone going to an event. */
export function eventMessageTemplate(data: EventMessageEmailData): RenderedEmail {
  const paragraphs = data.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return renderActionEmail(`${data.eventTitle}: ${data.subject}`, {
    preheader: paragraphs[0]?.slice(0, 120) ?? data.subject,
    heading: data.subject,
    intro: [
      `Hi ${data.name},`,
      `${data.senderName} from ${data.clubName} has a message about ${data.eventTitle} (${data.when}):`,
      ...paragraphs,
    ],
    action: { label: 'See the event', url: data.url },
    footnote: [
      `You're getting this because you ${data.waiting ? 'are on the waitlist for' : 'are going to'} ${data.eventTitle} in ${APP_NAME}. Replies to this email aren't read; to answer, contact ${data.clubName}.`,
    ],
  });
}
