import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

export interface JoinRequestApprovedData {
  name: string;
  orgName: string;
  // the workspace's page in the frontend
  url: string;
}

export function joinRequestApprovedTemplate({ name, orgName, url }: JoinRequestApprovedData): RenderedEmail {
  return renderActionEmail(`You're in: ${orgName}`, {
    preheader: `Your request to join ${orgName} on ${APP_NAME} was approved.`,
    heading: `Welcome to ${orgName}`,
    intro: [`Hi ${name},`, `Your request to join ${orgName} was approved. You're now a member.`],
    action: { label: `Open ${orgName}`, url },
    footnote: [`You received this because you asked to join ${orgName} on ${APP_NAME}.`],
  });
}

export interface JoinRequestRejectedData {
  name: string;
  orgName: string;
  // when they may ask again
  retryAfter: Date;
}

export function joinRequestRejectedTemplate({ name, orgName, retryAfter }: JoinRequestRejectedData): RenderedEmail {
  // e.g. "13 October 2026, 08:05 UTC": unambiguous for any reader
  const when = `${retryAfter.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
  return renderActionEmail(`Your request to join ${orgName}`, {
    preheader: `Your request to join ${orgName} was not approved.`,
    heading: 'Request not approved',
    intro: [
      `Hi ${name},`,
      `Your request to join ${orgName} was not approved this time.`,
      `You can ask again after ${when}.`,
    ],
    footnote: [`You received this because you asked to join ${orgName} on ${APP_NAME}.`],
  });
}
