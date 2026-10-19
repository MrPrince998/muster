import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildIcs } from '../../common/utils/ics.js';
import { EmailSender, type OutgoingEmail } from './email-sender.js';
import {
  eventCancelledTemplate,
  eventChangedTemplate,
  type EventCancelledEmailData,
  type EventChangedEmailData,
} from './templates/event-update.js';
import { guestConfirmTemplate, type GuestConfirmEmailData } from './templates/guest-confirm.js';
import { joinRequestApprovedTemplate, joinRequestRejectedTemplate } from './templates/join-request.js';
import { resetPasswordTemplate } from './templates/reset-password.js';
import { reminderTemplate } from './templates/reminder.js';
import { ticketTemplate, type TicketEmailData } from './templates/ticket.js';
import { verifyEmailTemplate } from './templates/verify-email.js';
import { newEventTemplate, type NewEventEmailData } from './templates/new-event.js';
import { digestTemplate, type DigestEmailData } from './templates/digest.js';

export const APP_URL = Symbol('APP_URL');
// the gap between emails in a bulk send: Resend accepts a few requests a second
export const BULK_PACE_MS = Symbol('BULK_PACE_MS');

/** The event a ticket is for, so the email can carry it as a calendar file. */
export interface TicketCalendar {
  eventId: string;
  startsAt: Date;
  endsAt: Date;
}

/** A ticket (or reminder) email: the QR code, and the event to add to a calendar. */
type TicketEmail = {
  to: string;
  qrPng: Buffer;
  registrationId: string;
  guestToken?: string;
  calendar?: TicketCalendar;
} & Omit<TicketEmailData, 'url'>;

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

  /**
   * A registration's ticket: the details, a link that opens it, and the QR
   * code as a PNG. Members' links open it in My tickets; a guest (who can't
   * sign in) gets `guestToken`, and a link to the ticket's own page instead.
   */
  sendTicket(
    email: TicketEmail,
  ): Promise<void> {
    const { to, qrPng, registrationId, guestToken, calendar, ...data } = email;
    const url = this.ticketUrl(registrationId, guestToken);
    return this.sender.send({
      to,
      ...ticketTemplate({ ...data, url }),
      attachments: [
        { filename: 'ticket.png', content: qrPng },
        ...this.calendarAttachment(calendar, data.eventTitle, data.clubName, data.where, url),
      ],
    });
  }

  /**
   * The day-before reminder, with the ticket again. One per registration,
   * even if a retry sends it twice (the provider drops the repeat).
   */
  sendReminder(
    email: TicketEmail,
  ): Promise<void> {
    const { to, qrPng, registrationId, guestToken, calendar, ...data } = email;
    const url = this.ticketUrl(registrationId, guestToken);
    return this.sender.send({
      to,
      ...reminderTemplate({ ...data, url }),
      attachments: [
        { filename: 'ticket.png', content: qrPng },
        ...this.calendarAttachment(calendar, data.eventTitle, data.clubName, data.where, url),
      ],
      idempotencyKey: `event-reminder/${registrationId}`,
    });
  }

  /** "Confirm your place": the link that turns a guest's request into a registration. */
  sendGuestConfirmation(
    email: { to: string; eventId: string; token: string } & Omit<GuestConfirmEmailData, 'url'>,
  ): Promise<void> {
    const { to, eventId, token, ...data } = email;
    const url = new URL(`/e/${eventId}/confirm`, this.appUrl);
    url.searchParams.set('token', token);
    return this.sender.send({ to, ...guestConfirmTemplate({ ...data, url: url.toString() }) });
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
    const url = this.eventUrl(event.orgSlug, event.clubId, event.eventId);
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
    const url = this.eventUrl(event.orgSlug, event.clubId, event.eventId);
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
  /**
   * A new event, to someone who asked to hear straight away. Carries
   * List-Unsubscribe, so mail apps offer their own one-click "stop".
   */
  sendNewEvent(to: string, data: NewEventEmailData, key: string): Promise<void> {
    return this.sender.send({ to, ...newEventTemplate(data), idempotencyKey: key, headers: unsubscribe(data.stopUrl) });
  }

  /** The weekly digest of what's coming up. */
  sendDigest(to: string, data: DigestEmailData, key: string): Promise<void> {
    return this.sender.send({ to, ...digestTemplate(data), idempotencyKey: key, headers: unsubscribe(data.stopUrl) });
  }

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

  // straight to one ticket: My tickets opens the one named in ?ticket=; a
  // guest (who can't sign in) gets the ticket's own page instead
  // "event.ics": one tap adds it to the reader's calendar, with the way back to the ticket
  private calendarAttachment(
    calendar: TicketCalendar | undefined,
    title: string,
    clubName: string,
    where: string | null,
    ticketUrl: string,
  ): { filename: string; content: Buffer }[] {
    if (!calendar) return [];
    const ics = buildIcs({ ...calendar, title, location: where, description: `${clubName}. Your ticket: ${ticketUrl}`, url: ticketUrl });
    return [{ filename: 'event.ics', content: Buffer.from(ics, 'utf8') }];
  }

  private ticketUrl(registrationId: string, guestToken?: string): string {
    if (guestToken) return new URL(`/t/${guestToken}`, this.appUrl).toString();
    const url = new URL('/tickets', this.appUrl);
    url.searchParams.set('ticket', registrationId);
    return url.toString();
  }

  // the club's events with this one open: /o/:slug?club=…&event=…
  private eventUrl(orgSlug: string, clubId: string, eventId: string): string {
    const url = new URL(`/o/${orgSlug}`, this.appUrl);
    url.searchParams.set('club', clubId);
    url.searchParams.set('event', eventId);
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

// RFC 8058: a mail app can turn these off with one POST. The link people
// click opens a page that asks first (so a link scanner can't); the
// header's address beside it acts straight away.
function unsubscribe(stopUrl: string): Record<string, string> {
  const oneClick = stopUrl.replace('/unsubscribe?', '/unsubscribe/one-click?');
  return { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}
