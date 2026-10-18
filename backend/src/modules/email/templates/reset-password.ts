import { formatDuration } from './html.js';
import { APP_NAME, renderActionEmail, type RenderedEmail } from './layout.js';

export interface ResetPasswordData {
  name: string;
  url: string;
  expiresInMinutes: number;
}

export function resetPasswordTemplate({ name, url, expiresInMinutes }: ResetPasswordData): RenderedEmail {
  const expires = formatDuration(expiresInMinutes);
  return renderActionEmail(`Reset your ${APP_NAME} password`, {
    preheader: `Use this link to choose a new password. It expires in ${expires}.`,
    heading: 'Reset your password',
    intro: [
      `Hi ${name},`,
      `We received a request to reset the password for your ${APP_NAME} account. Choose a new password using the link below.`,
    ],
    action: { label: 'Choose a new password', url },
    footnote: [
      `This link expires in ${expires} and can only be used once. Resetting your password signs you out on every device.`,
      `If you did not ask to reset your password, you can ignore this email. Your password will not change.`,
    ],
  });
}
