import { renderActionEmail, type RenderedEmail } from './layout.js';

export interface NewEventEmailData {
  name: string;
  clubName: string;
  eventTitle: string;
  when: string;
  where: string | null;
  // a series: "Every week, 6 times"
  repeats?: string;
  // the event in the app
  url: string;
  // turns these emails off for this club, no sign-in needed
  stopUrl: string;
}

/** A new event, as the members who asked to hear straight away hear of it. */
export function newEventTemplate(data: NewEventEmailData): RenderedEmail {
  return renderActionEmail(`New in ${data.clubName}: ${data.eventTitle}`, {
    preheader: `${data.when}${data.where ? `, ${data.where}` : ''}`,
    heading: data.eventTitle,
    intro: [
      `Hi ${data.name},`,
      `${data.clubName} has a new event${data.repeats ? ' series' : ''}.`,
      `When: ${data.when}`,
      ...(data.repeats ? [`Repeats: ${data.repeats}`] : []),
      ...(data.where ? [`Where: ${data.where}`] : []),
    ],
    action: { label: 'See the event', url: data.url },
    footnote: [
      `You get these because you asked to hear about new ${data.clubName} events. To stop them: ${data.stopUrl}`,
    ],
  });
}
