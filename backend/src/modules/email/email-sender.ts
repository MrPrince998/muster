import { Logger } from '@nestjs/common';
import type { Resend } from 'resend';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  // retries with the same key are delivered once (Resend keeps keys for 24h)
  idempotencyKey?: string;
  // files sent with it, e.g. the ticket's QR code as a PNG
  attachments?: { filename: string; content: Buffer }[];
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Where emails go. Injected as a class token so tests and development can
 * swap the transport without touching EmailService.
 */
export abstract class EmailSender {
  abstract send(email: OutgoingEmail): Promise<void>;
}

export class ResendEmailSender extends EmailSender {
  constructor(
    private readonly resend: Resend,
    private readonly from: string,
  ) {
    super();
  }

  async send({ to, subject, html, text, idempotencyKey, attachments }: OutgoingEmail): Promise<void> {
    // the SDK reports failures in `error` instead of throwing
    const { error } = await this.resend.emails.send(
      { from: this.from, to: [to], subject, html, text, ...(attachments?.length && { attachments }) },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    if (error) {
      throw new EmailDeliveryError(`Resend rejected email "${subject}": ${error.message}`);
    }
  }
}

/**
 * Development transport: prints the plain-text version, links included, so
 * flows can be tested without a Resend account. Never used in production
 * (config requires RESEND_API_KEY there).
 */
export class LogEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');

  send({ to, subject, text, attachments }: OutgoingEmail): Promise<void> {
    const files = attachments?.length ? `\n\nAttached: ${attachments.map((a) => a.filename).join(', ')}` : '';
    this.logger.log(`To: ${to}\nSubject: ${subject}\n\n${text}${files}`);
    return Promise.resolve();
  }
}

// Domains reserved for testing and documentation (RFC 2606, RFC 6761): no
// mailbox there can exist, so a send can only bounce.
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

/** Whether an address is on a domain that can never receive mail. */
export function isReservedAddress(address: string): boolean {
  const domain = address.split('@').pop()?.toLowerCase() ?? '';
  return (
    RESERVED_TLDS.some((tld) => domain === tld || domain.endsWith(`.${tld}`)) ||
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))
  );
}

/**
 * Wraps a real transport: mail to reserved test domains is logged instead of
 * sent, so test accounts (e2e@example.test) never reach the provider, burn
 * quota, or hurt the sending domain's reputation with bounces.
 */
export class SkipReservedDomains extends EmailSender {
  private readonly logger = new Logger('Email');

  constructor(private readonly inner: EmailSender) {
    super();
  }

  send(email: OutgoingEmail): Promise<void> {
    if (isReservedAddress(email.to)) {
      this.logger.log(`Not sent (reserved test domain): "${email.subject}" to ${email.to}`);
      return Promise.resolve();
    }
    return this.inner.send(email);
  }
}
