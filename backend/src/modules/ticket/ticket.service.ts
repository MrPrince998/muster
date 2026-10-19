import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import QRCode from 'qrcode';
import { config } from '../../config/config.js';

// A ticket stays valid until a day after its event ends, so a late scan or a
// slow door still works, and old tickets don't verify forever.
const GRACE_SECONDS = 24 * 60 * 60;

export interface GuestConfirmation {
  eventId: string;
  email: string;
  name: string;
  // their answers to the event's questions, checked when they asked
  answers?: Record<string, string>;
  // the ticket they chose, and any discount code
  ticketTypeId?: string;
  code?: string;
}

interface TicketClaims {
  // the registration id: what check-in looks up
  sub: string;
  // the event id: lets a scanner reject another event's ticket before any lookup
  evt: string;
}

/**
 * Signed tickets (README: "Signed tickets"). A small HS256 JWT with only the
 * registration and event ids, signed with TICKET_SECRET, never JWT_SECRET:
 * a leaked login secret can't forge tickets, nor a ticket pass as a login.
 * A valid signature proves the ticket is genuine, not unused; check-in's
 * atomic UPDATE decides that.
 */
@Injectable()
export class TicketService {
  private readonly jwt = new JwtService({
    secret: config.ticket.secret,
    // the audience marks it a ticket; the separate secret already rules out
    // other tokens, so no issuer claim: every byte makes the QR code denser
    signOptions: { algorithm: 'HS256', audience: 'ticket' },
    verifyOptions: { algorithms: ['HS256'], audience: 'ticket' },
  });

  sign(registrationId: string, eventId: string, eventEndsAt: Date): Promise<string> {
    const expiresIn = Math.max(60, Math.floor((eventEndsAt.getTime() - Date.now()) / 1000) + GRACE_SECONDS);
    return this.jwt.signAsync({ sub: registrationId, evt: eventId } satisfies TicketClaims, { expiresIn });
  }

  /** The ticket's ids, or null if it is malformed, forged, expired or not a ticket. */
  async verify(token: string): Promise<{ registrationId: string; eventId: string } | null> {
    if (typeof token !== 'string' || token.length > 1000) return null;
    try {
      const claims = await this.jwt.verifyAsync<TicketClaims>(token);
      if (!isUUID(claims.sub) || !isUUID(claims.evt)) return null;
      return { registrationId: claims.sub, eventId: claims.evt };
    } catch {
      return null;
    }
  }

  // --- a guest's "confirm your place" link ------------------------------------
  // Same secret, different audience: a confirmation can't pass as a ticket,
  // nor a ticket as a confirmation. Stateless: nothing is stored until the
  // link is used, so asking costs nothing but an email.
  private readonly confirmations = new JwtService({
    secret: config.ticket.secret,
    signOptions: { algorithm: 'HS256', audience: 'guest-confirm', expiresIn: '24h' },
    verifyOptions: { algorithms: ['HS256'], audience: 'guest-confirm' },
  });

  signGuestConfirmation(claims: GuestConfirmation): Promise<string> {
    return this.confirmations.signAsync({
      evt: claims.eventId,
      email: claims.email,
      name: claims.name,
      ...(claims.answers && Object.keys(claims.answers).length > 0 && { ans: claims.answers }),
      ...(claims.ticketTypeId && { tt: claims.ticketTypeId }),
      ...(claims.code && { dc: claims.code }),
    });
  }

  /** Who asked for a place at which event, or null if the link is malformed, forged or over a day old. */
  async verifyGuestConfirmation(token: string): Promise<GuestConfirmation | null> {
    // answers make it longer: five of them, up to 300 characters each
    if (typeof token !== 'string' || token.length > 8000) return null;
    try {
      const claims = await this.confirmations.verifyAsync<{
        evt: string;
        email: string;
        name: string;
        ans?: Record<string, string>;
        tt?: string;
        dc?: string;
      }>(token);
      if (!isUUID(claims.evt) || typeof claims.email !== 'string' || typeof claims.name !== 'string') return null;
      return {
        eventId: claims.evt,
        email: claims.email,
        name: claims.name,
        answers: claims.ans ?? {},
        ticketTypeId: claims.tt,
        code: claims.dc,
      };
    } catch {
      return null;
    }
  }

  // Tickets are shown on screens, not printed and scuffed, so the lowest error
  // correction is enough: it keeps the code coarser, which phones in a dim
  // doorway read more easily.

  /** The QR code as SVG markup, for the app (scales cleanly, no image request). */
  qrSvg(token: string): Promise<string> {
    return QRCode.toString(token, { type: 'svg', errorCorrectionLevel: 'L', margin: 1 });
  }

  /** The QR code as a PNG, for the email attachment. */
  qrPng(token: string): Promise<Buffer> {
    return QRCode.toBuffer(token, { type: 'png', errorCorrectionLevel: 'L', margin: 2, width: 480 });
  }
}
