import { escapeHtml } from './html.js';

// The product's name in every email (subjects, footers): change it here and they all follow.
export const APP_NAME = 'Muster';

export interface RenderedEmail {
  subject: string;
  html: string;
  // plain-text part: shown by text-only clients and used by spam filters
  text: string;
}

export interface ActionEmailContent {
  // hidden preview line shown next to the subject in the inbox
  preheader: string;
  heading: string;
  // paragraphs of plain text, escaped here
  intro: string[];
  // the button; omit for emails with nothing to click (e.g. a rejection)
  action?: { label: string; url: string };
  // smaller print under the button, plain text
  footnote: string[];
}

const colors = {
  text: '#18181b',
  muted: '#52525b',
  border: '#e4e4e7',
  background: '#f4f4f5',
  card: '#ffffff',
  button: '#18181b',
  buttonText: '#ffffff',
};

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * One layout for every transactional email: a single card with a heading,
 * text, one button, and the raw link as a fallback.
 *
 * Built for email clients, not browsers: tables for layout, inline styles
 * (many clients drop <style> blocks), no images or web fonts, and a button
 * that still works where padding on links is ignored.
 */
export function renderActionEmail(subject: string, content: ActionEmailContent): RenderedEmail {
  const paragraph = (text: string, color = colors.text, size = 16) =>
    `<p style="margin:0 0 16px;font-family:${font};font-size:${size}px;line-height:1.5;color:${color};">${escapeHtml(text)}</p>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${colors.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${colors.background};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 0 16px;font-family:${font};font-size:14px;font-weight:600;color:${colors.muted};">${escapeHtml(APP_NAME)}</td>
        </tr>
        <tr>
          <td style="background:${colors.card};border:1px solid ${colors.border};border-radius:8px;padding:32px;">
            <h1 style="margin:0 0 16px;font-family:${font};font-size:22px;line-height:1.3;font-weight:600;color:${colors.text};">${escapeHtml(content.heading)}</h1>
            ${content.intro.map((text) => paragraph(text)).join('\n            ')}
            ${content.action ? button(content.action) : ''}
            ${content.footnote.map((text) => paragraph(text, colors.muted, 14)).join('\n            ')}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    content.heading,
    '',
    ...content.intro.flatMap((p) => [p, '']),
    ...(content.action ? [`${content.action.label}: ${content.action.url}`, ''] : []),
    ...content.footnote.flatMap((p) => [p, '']),
    `- ${APP_NAME}`,
  ].join('\n');

  return { subject, html, text };

  // a button plus the raw link, for clients that block or mangle buttons
  function button(action: { label: string; url: string }): string {
    const url = escapeHtml(action.url);
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
              <tr>
                <td align="center" bgcolor="${colors.button}" style="border-radius:6px;">
                  <a href="${url}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${font};font-size:16px;font-weight:600;color:${colors.buttonText};text-decoration:none;border-radius:6px;">${escapeHtml(action.label)}</a>
                </td>
              </tr>
            </table>
            ${paragraph('If the button does not work, copy this link into your browser:', colors.muted, 14)}
            <p style="margin:0 0 24px;font-family:${font};font-size:13px;line-height:1.5;word-break:break-all;"><a href="${url}" target="_blank" style="color:${colors.muted};">${url}</a></p>`;
  }
}
