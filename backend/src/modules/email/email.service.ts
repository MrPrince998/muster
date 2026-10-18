import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmailSender, type OutgoingEmail } from './email-sender.js';
import {
  eventCancelledTemplate,
  eventChangedTemplate,
  type EventCancelledEmailData,
  type EventChangedEmailData,
} from './templates/event-update.js';
import { joinRequestApprovedTemplate, joinRequestRejectedTemplate } from './templates/join-request.js';
import { resetPasswordTemplate } from './templates/reset-password.js';
import { ticketTemplate, type TicketEmailData } from './templates/ticket.js';
import { verifyEmailTemplate } from './templates/verify-email.js';

export const APP_URL = Symbol('APP_URL');
// the gap between emails in a bulk send: Resend accepts a few requests a second
export const BULK_PACE_MS = Symbol('BULK_PACE_MS');

/** One registrant of an event, for the emails sent to all of them. */
export interface EventRecipient {
  registrationId: string;
  to: string;
  name: string;
}

export interface TokenEmail {
  to: string;
  name: string;
  // the raw token: only ever in the link, never stored
  token: string;
  expiresInMinutes: number;
  // e.g. the email_tokens row id, so a retried send is delivered once
  idempotencyKey?: string;
  // verification only: a page to go on to after confirming (validated as a
  // same-site path by the DTO), e.g. the invite link they signed up from
  next?: string;
}

/**
 * Renders and sends transactional emails. Throws EmailDeliveryError if the
 * provider rejects a message; callers decide whether that fails the request
 * (password reset) or is only logged (sign-up, where the user can ask for the
 * link again).
 */
export interface JoinRequestEmail {
  to: string;
  name: string;
  orgName: string;
  // the join request's id, so a retried send is delivered once
  requestId: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly sender: EmailSender,
    @Inject(APP_URL) private readonly appUrl: string,
    @Inject(BULK_PACE_MS) private readonly bulkPaceMs: number,
  ) {}

  sendVerifyEmail({ to, name, token, expiresInMinutes, idempotencyKey, next }: TokenEmail): Promise<void> {
    const url = this.link('/verify-email', token, next ? { next } : undefined);
    return this.sender.send({
      to,
      ...verifyEmailTemplate({ name, url, expiresInMinutes }),
      idempotencyKey,
    });
  }

  sendPasswordReset({ to, name, token, expiresInMinutes, idempotencyKey }: TokenEmail): Promise<void> {
    const url = this.link('/reset-password', token);
    return this.sender.send({
      to,
      ...resetPasswordTemplate({ name, url, expiresInMinutes }),
      idempotencyKey,
    });
  }

  /** A registration's ticket: the details, a link that opens it in the app, and the QR code as a PNG. */
  sendTicket(
    email: { to: string; qrPng: Buffer; registrationId: string } & Omit<TicketEmailData, 'url'>,
  ): Promise<void> {
    const { to, qrPng, registrationId, ...data } = email;
    // straight to this ticket: the tickets page opens the one named in ?ticket=
    const url = new URL('/tickets', this.appUrl);
    url.searchParams.set('ticket', registrationId);
    return this.sender.send({
      to,
      ...ticketTemplate({ ...data, url: url.toString() }),
      attachments: [{ filename: 'ticket.png', content: qrPng }],
    });
  }

  sendJoinRequestApproved(email: JoinRequestEmail & { orgSlug: string }): Promise<void> {
    return this.sender.send({
      to: email.to,
      ...joinRequestApprovedTemplate({
        name: email.name,
        orgName: email.orgName,
        url: new URL(`/o/${email.orgSlug}`, this.appUrl).toString(),
      }),
      idempotencyKey: `join-request-approved/${email.requestId}`,
    });
  }

  sendJoinRequestRejected(email: JoinRequestEmail & { retryAfter: Date }): Promise<void> {
    return this.sender.send({
      to: email.to,
      ...joinRequestRejectedTemplate({ name: email.name, orgName: email.orgName, retryAfter: email.retryAfter }),
      idempotencyKey: `join-request-rejected/${email.requestId}`,
    });
  }

  /** Tells everyone registered that the event is off. Each person gets it once, however often this runs. */
  sendEventCancelled(
    recipients: EventRecipient[],
    event: Omit<EventCancelledEmailData, 'name' | 'url'> & { orgSlug: string; clubId: string; eventId: string },
  ): Promise<void> {
    const url = this.clubEventsUrl(event.orgSlug, event.clubId);
    return this.sendEach('event cancelled', recipients, (r) => ({
      to: r.to,
      ...eventCancelledTemplate({ ...event, name: r.name, url }),
      idempotencyKey: `event-cancelled/${r.registrationId}`,
    }));
  }

  /** Tells everyone registered about a new time or place. */
  sendEventChanged(
    recipients: EventRecipient[],
    event: Omit<EventChangedEmailData, 'name' | 'url'> & { orgSlug: string; clubId: string; eventId: string },
  ): Promise<void> {
    const url = this.clubEventsUrl(event.orgSlug, event.clubId);
    return this.sendEach('event changed', recipients, (r) => ({
      to: r.to,
      ...eventChangedTemplate({ ...event, name: r.name, url }),
    }));
  }

  /**
   * Sends without making the caller wait or fail: the work the email reports
   * on is already done, so a provider outage is logged instead of undoing it.
   * Not awaiting also keeps response times the same whether or not an email
   * goes out, which matters where that would reveal whether an account exists.
   */
  inBackground(kind: string, sending: Promise<void>): void {
    sending.catch((error: unknown) =>
      this.logger.error(`Sending ${kind} email failed`, error instanceof Error ? error.stack : error),
    );
  }

  // one at a time, paced for the provider's rate limit; one bad address
  // doesn't stop the rest
  private async sendEach(
    kind: string,
    recipients: EventRecipient[],
    build: (recipient: EventRecipient) => OutgoingEmail,
  ): Promise<void> {
    let failed = 0;
    for (const [index, recipient] of recipients.entries()) {
      if (index > 0 && this.bulkPaceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.bulkPaceMs));
      try {
        await this.sender.send(build(recipient));
      } catch (error) {
        failed++;
        this.logger.error(`Sending ${kind} email failed`, error instanceof Error ? error.stack : error);
      }
    }
    if (failed > 0) this.logger.warn(`${failed} of ${recipients.length} ${kind} emails failed`);
  }

  private clubEventsUrl(orgSlug: string, clubId: string): string {
    const url = new URL(`/o/${orgSlug}`, this.appUrl);
    url.searchParams.set('club', clubId);
    return url.toString();
  }

  // frontend page + token; the page posts the token back to the API
  private link(path: string, token: string, extra?: Record<string, string>): string {
    const url = new URL(path, this.appUrl);
    url.searchParams.set('token', token);
    for (const [key, value] of Object.entries(extra ?? {})) url.searchParams.set(key, value);
    return url.toString();
  }
}
