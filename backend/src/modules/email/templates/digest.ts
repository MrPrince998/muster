import { renderActionEmail, type RenderedEmail } from './layout.js';

export interface DigestEmailData {
  name: string;
  workspaceName: string;
  // in date order: "Thu 24 Oct, 18:30: Build Night (Robotics Society)"
  events: { line: string; isNew: boolean }[];
  url: string;
  stopUrl: string;
}

/** Monday's email: the next two weeks in the clubs someone follows weekly. */
export function digestTemplate(data: DigestEmailData): RenderedEmail {
  const fresh = data.events.filter((e) => e.isNew).length;
  return renderActionEmail(`Coming up in ${data.workspaceName}`, {
    preheader:
      fresh > 0
        ? `${fresh} new ${fresh === 1 ? 'event' : 'events'}, ${data.events.length} in the next two weeks`
        : `${data.events.length} ${data.events.length === 1 ? 'event' : 'events'} in the next two weeks`,
    heading: 'The next two weeks',
    intro: [`Hi ${data.name},`, ...data.events.map((e) => `${e.isNew ? 'New: ' : ''}${e.line}`)],
    action: { label: 'See what’s on', url: data.url },
    footnote: [`You get this weekly because you chose it for clubs in ${data.workspaceName}. To stop it: ${data.stopUrl}`],
  });
}
