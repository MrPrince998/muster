import type { Resend } from 'resend';
import {
  EmailDeliveryError,
  EmailSender,
  isReservedAddress,
  ResendEmailSender,
  SkipReservedDomains,
  type OutgoingEmail,
} from './email-sender.js';
import { EmailService } from './email.service.js';

class RecordingSender extends EmailSender {
  sent: OutgoingEmail[] = [];
  send(email: OutgoingEmail) {
    this.sent.push(email);
    return Promise.resolve();
  }
}

describe('EmailService', () => {
  const setup = () => {
    const sender = new RecordingSender();
    return { sender, service: new EmailService(sender, 'https://app.example.com') };
  };

  it('sends a verification link to the frontend page, token URL-encoded', async () => {
    const { sender, service } = setup();
    await service.sendVerifyEmail({
      to: 'ada@example.com',
      name: 'Ada',
      token: 'a+b/c=',
      expiresInMinutes: 1440,
      idempotencyKey: 'email-token-1',
    });

    const [email] = sender.sent;
    expect(email).toMatchObject({ to: 'ada@example.com', idempotencyKey: 'email-token-1' });
    expect(email.text).toContain('https://app.example.com/verify-email?token=a%2Bb%2Fc%3D');
    expect(email.text).toContain('24 hours');
  });

  it('adds `next` to the verification link when there is one', async () => {
    const { sender, service } = setup();
    await service.sendVerifyEmail({
      to: 'ada@example.com',
      name: 'Ada',
      token: 'tok',
      expiresInMinutes: 1440,
      next: '/join/abc123',
    });

    expect(sender.sent[0].text).toContain('https://app.example.com/verify-email?token=tok&next=%2Fjoin%2Fabc123');
  });

  it('sends a reset link to the reset page', async () => {
    const { sender, service } = setup();
    await service.sendPasswordReset({ to: 'ada@example.com', name: 'Ada', token: 't', expiresInMinutes: 30 });
    expect(sender.sent[0].text).toContain('https://app.example.com/reset-password?token=t');
  });
});

describe('ResendEmailSender', () => {
  const email: OutgoingEmail = { to: 'ada@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

  const resendWith = (result: unknown) => {
    const send = vi.fn().mockResolvedValue(result);
    return { send, resend: { emails: { send } } as unknown as Resend };
  };

  it('sends from the configured address and passes the idempotency key', async () => {
    const { send, resend } = resendWith({ data: { id: 'e1' }, error: null });
    await new ResendEmailSender(resend, 'App <no-reply@example.com>').send({ ...email, idempotencyKey: 'k1' });

    expect(send).toHaveBeenCalledWith(
      { from: 'App <no-reply@example.com>', to: ['ada@example.com'], subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' },
      { idempotencyKey: 'k1' },
    );
  });

  it('throws when Resend reports an error (the SDK does not throw)', async () => {
    const { resend } = resendWith({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field' } });
    await expect(new ResendEmailSender(resend, 'App <a@b.c>').send(email)).rejects.toBeInstanceOf(
      EmailDeliveryError,
    );
  });
});

describe('reserved test domains', () => {
  it.each(['a@example.test', 'b@sub.example.test', 'c@example.com', 'd@mail.example.org', 'e@x.invalid', 'f@localhost'])(
    '%s can never receive mail',
    (address) => expect(isReservedAddress(address)).toBe(true),
  );

  it.each(['ada@gmail.com', 'me@bharatrana.com.np', 'x@testing.com', 'y@example.co'])('%s is a real address', (address) =>
    expect(isReservedAddress(address)).toBe(false),
  );

  it('logs instead of sending to them, and sends to everyone else', async () => {
    const inner = new RecordingSender();
    const sender = new SkipReservedDomains(inner);
    const email = { subject: 's', html: 'h', text: 't' };
    await sender.send({ ...email, to: 'e2e@example.test' });
    await sender.send({ ...email, to: 'ada@gmail.com' });
    expect(inner.sent.map((e) => e.to)).toEqual(['ada@gmail.com']);
  });
});

describe('EmailService.sendTicket', () => {
  it('links straight to this ticket and attaches the QR code', async () => {
    const sender = new RecordingSender();
    const service = new EmailService(sender, 'https://app.example.com');
    const qrPng = Buffer.from('png');
    await service.sendTicket({
      to: 'ada@example.com',
      registrationId: 'reg-123',
      name: 'Ada',
      eventTitle: 'Hack <Night>',
      clubName: 'Coding Club',
      when: 'Saturday 24 October 2026, 18:30 to 22:00 (UTC)',
      where: 'Hall B',
      qrPng,
    });
    const [email] = sender.sent;
    expect(email.subject).toBe('Your ticket: Hack <Night>');
    expect(email.text).toContain('Open your ticket: https://app.example.com/tickets?ticket=reg-123');
    expect(email.html).toContain('Hack &lt;Night&gt;'); // escaped
    expect(email.attachments).toEqual([{ filename: 'ticket.png', content: qrPng }]);
  });
});
