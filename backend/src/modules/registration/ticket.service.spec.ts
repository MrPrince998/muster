import { JwtService } from '@nestjs/jwt';
import { config } from '../../config/config.js';
import { TicketService } from './ticket.service.js';

const registrationId = '0b8f7c1e-2f7a-4f3e-9a51-6f0f5e2b1c11';
const eventId = '6a1d2b3c-4e5f-4a7b-8c9d-0e1f2a3b4c5d';
const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

describe('TicketService', () => {
  const tickets = new TicketService();

  it('signs a ticket that verifies back to its ids', async () => {
    const token = await tickets.sign(registrationId, eventId, inAWeek());
    await expect(tickets.verify(token)).resolves.toEqual({ registrationId, eventId });
  });

  it('carries only the ids, no personal data', async () => {
    const token = await tickets.sign(registrationId, eventId, inAWeek());
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['aud', 'evt', 'exp', 'iat', 'sub']);
  });

  it('rejects a ticket whose contents were changed', async () => {
    const token = await tickets.sign(registrationId, eventId, inAWeek());
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: registrationId, evt: '11111111-1111-4111-8111-111111111111' })).toString('base64url');
    await expect(tickets.verify(`${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it('rejects a ticket signed with the login secret', async () => {
    const withLoginSecret = new JwtService({ secret: config.jwt.secret });
    const token = await withLoginSecret.signAsync({ sub: registrationId, evt: eventId }, { audience: 'ticket' });
    await expect(tickets.verify(token)).resolves.toBeNull();
  });

  it('rejects a token for something other than a ticket, even with the right secret', async () => {
    const sameSecret = new JwtService({ secret: config.ticket.secret });
    const token = await sameSecret.signAsync({ sub: registrationId, evt: eventId }, { audience: 'login' });
    await expect(tickets.verify(token)).resolves.toBeNull();
  });

  it('rejects an expired ticket', async () => {
    const sameSecret = new JwtService({ secret: config.ticket.secret });
    const token = await sameSecret.signAsync(
      { sub: registrationId, evt: eventId },
      { audience: 'ticket', expiresIn: -10 },
    );
    await expect(tickets.verify(token)).resolves.toBeNull();
  });

  it('keeps working for a day after the event ends', async () => {
    const endedAnHourAgo = new Date(Date.now() - 3600 * 1000);
    const token = await tickets.sign(registrationId, eventId, endedAnHourAgo);
    await expect(tickets.verify(token)).resolves.toEqual({ registrationId, eventId });
  });

  it.each(['', 'not-a-jwt', 'a.b.c', 'x'.repeat(2000)])('rejects garbage: %s', async (garbage) => {
    await expect(tickets.verify(garbage)).resolves.toBeNull();
  });

  it('keeps the QR code coarse enough for a phone in a dim doorway', async () => {
    const QRCode = (await import('qrcode')).default;
    const token = await tickets.sign(registrationId, eventId, inAWeek());
    // version 10 is 57x57 modules; denser codes scan noticeably worse
    expect(QRCode.create(token, { errorCorrectionLevel: 'L' }).version).toBeLessThanOrEqual(10);
  });

  it('draws the QR code as SVG and as PNG', async () => {
    const token = await tickets.sign(registrationId, eventId, inAWeek());
    expect(await tickets.qrSvg(token)).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    const png = await tickets.qrPng(token);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});
