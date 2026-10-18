import { formatDuration } from './html.js';
import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

export interface VerifyEmailData {
  name: string;
  url: string;
  expiresInMinutes: number;
}

export function verifyEmailTemplate({ name, url, expiresInMinutes }: VerifyEmailData): RenderedEmail {
  const expires = formatDuration(expiresInMinutes);
  return renderActionEmail(`Confirm your email for ${APP_NAME}`, {
    preheader: `Confirm your email address to finish setting up your account. The link expires in ${expires}.`,
    heading: 'Confirm your email address',
    intro: [
      `Hi! ${name},`,
      `Thanks for signing up for ${APP_NAME}. Confirm this is your email address to finish setting up your account.`,
    ],
    action: { label: 'Confirm email address', url },
    footnote: [
      `This link expires in ${expires} and can only be used once.`,
      `If you did not create an account, you can ignore this email.`,
    ],
  });
}