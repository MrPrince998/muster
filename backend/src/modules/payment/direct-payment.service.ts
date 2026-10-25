import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { TenantService } from '../../database/tenant.service.js';
import { audit, AuditAction } from '../audit/audit.js';
import { EmailService } from '../email/email.service.js';
import { FileStorage, imageKind } from '../files/file-storage.js';
import type { OrgMembership } from '../organisation/org-roles.js';
import type { ClubAccess } from '../permission/club-access.js';
import { Permission } from '../permission/permissions.js';
import { insertPlace } from '../registration/place.js';
import { freePlaces } from '../waitlist/waitlist.service.js';
import type { PendingDirectPaymentDto, UpdatePaymentSettingsDto } from './dto/direct-payment.dto.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentService, type PaymentStatus } from './payment.service.js';

const MAX_QR_BYTES = 2 * 1024 * 1024;

const missingPermission = (missing: Permission[]) =>
  HttpError.forbidden('Missing permission', 'MISSING_PERMISSION', { missing });

const paymentNotFound = () => HttpError.notFound('Payment not found', 'PAYMENT_NOT_FOUND');

interface HeldRow {
  id: string;
  user_id: string;
  status: string;
  expires_at: Date;
  amount_cents: number;
  currency: string;
  reference: string;
  answers: Record<string, string>;
  ticket_type_id: string | null;
  discount_code_id: string | null;
  event_status: string;
  ends_at: Date;
  capacity: number | null;
  created_by: string | null;
  title: string;
}

/**
 * Paying the organisers directly (migration DirectPayments), for
 * workspaces Stripe doesn't serve: they say how to be paid, a buyer's place
 * is held while they pay with a reference, and an organiser marks it paid
 * (the ticket follows) or turns it down (the place goes back on offer).
 * Muster never holds the money, and refunds are the organisers' to make.
 */
@Injectable()
export class DirectPaymentService {
  constructor(
    private readonly tenant: TenantService,
    private readonly payments: PaymentService,
    private readonly gateway: PaymentGateway,
    private readonly files: FileStorage,
    private readonly email: EmailService,
  ) {}

  // --- the workspace's settings (owner and admins) ------------------------------------

  /**
   * How buyers pay: through Stripe (only where this Muster has it), or to
   * the organisers directly, which needs a currency and instructions.
   * Events already priced keep their currency.
   */
  async update(me: OrgMembership, dto: UpdatePaymentSettingsDto): Promise<PaymentStatus> {
    return this.tenant.withTenant(me.orgId, async (m) => {
      const [org]: {
        payment_method: 'stripe' | 'direct';
        direct_currency: string | null;
        direct_instructions: string | null;
      }[] = await m.query(
        `SELECT payment_method, direct_currency, direct_instructions FROM organisations WHERE id = $1 FOR UPDATE`,
        [me.orgId],
      );
      const method = dto.method ?? org.payment_method;
      const currency = dto.currency ?? org.direct_currency;
      const instructions = dto.instructions === undefined ? org.direct_instructions : dto.instructions.trim() || null;
      if (method === 'stripe' && !this.gateway.enabled) {
        throw HttpError.serviceUnavailable("Stripe isn't set up on this Muster", 'PAYMENTS_UNAVAILABLE');
      }
      if (method === 'direct' && (!currency || !instructions)) {
        throw HttpError.badRequest('Say how to pay you, and in what currency', 'DIRECT_DETAILS_REQUIRED');
      }
      await m.query(
        `UPDATE organisations
         SET payment_method = $2, direct_currency = $3, direct_instructions = $4,
             direct_hold_hours = COALESCE($5, direct_hold_hours)
         WHERE id = $1`,
        [me.orgId, method, currency, instructions, dto.holdHours ?? null],
      );
      if (method !== org.payment_method || (method === 'direct' && currency !== org.direct_currency)) {
        await audit(m, {
          actorId: me.userId,
          action: AuditAction.PaymentsSettingsChanged,
          details: { method, ...(method === 'direct' && { currency }) },
        });
      }
      return this.payments.statusIn(m, me.orgId);
    });
  }

  /** The workspace's payment QR code (eSewa, Khalti, Fonepay, a bank's): a JPEG, PNG or WebP of 2 MB at most. */
  async setQr(me: OrgMembership, data: unknown): Promise<PaymentStatus> {
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw HttpError.badRequest('Send the image itself, as image/webp, image/jpeg or image/png', 'IMAGE_REQUIRED');
    }
    if (data.length > MAX_QR_BYTES) throw HttpError.badRequest('Images can be 2 MB at most', 'IMAGE_TOO_LARGE');
    const kind = imageKind(data);
    if (!kind) throw HttpError.badRequest("That isn't a JPEG, PNG or WebP image", 'IMAGE_NOT_SUPPORTED');
    const key = `qr/${randomUUID()}.${kind}`;
    await this.files.put(key, data);
    try {
      return await this.replaceQr(me, key);
    } catch (error) {
      await this.files.delete(key);
      throw error;
    }
  }

  removeQr(me: OrgMembership): Promise<PaymentStatus> {
    return this.replaceQr(me, null);
  }

  private async replaceQr(me: OrgMembership, key: string | null): Promise<PaymentStatus> {
    const { status, old } = await this.tenant.withTenant(me.orgId, async (m) => {
      const [org]: { direct_qr_key: string | null }[] = await m.query(
        `SELECT direct_qr_key FROM organisations WHERE id = $1 FOR UPDATE`,
        [me.orgId],
      );
      await m.query(`UPDATE organisations SET direct_qr_key = $2 WHERE id = $1`, [me.orgId, key]);
      return { status: await this.payments.statusIn(m, me.orgId), old: org.direct_qr_key };
    });
    if (old) await this.files.delete(old);
    return status;
  }

  // --- an event's payments (people who can edit it) -----------------------------------

  /**
   * Payments waiting for an organiser, oldest first: those still held, and
   * those whose hold ran out (someone may have paid late).
   */
  async pending(access: ClubAccess, eventId: string): Promise<PendingDirectPaymentDto[]> {
    return this.inClub(access, async (m) => {
      await this.manageable(m, access, eventId);
      const rows: {
        id: string;
        name: string;
        email: string;
        guest: boolean;
        reference: string;
        amount_cents: number;
        currency: string;
        ticket_type: string | null;
        created_at: Date;
        expires_at: Date;
      }[] = await m.query(
        `SELECT h.id, u.name, u.email, (u.password_hash IS NULL) AS guest, h.reference, h.amount_cents, h.currency,
                t.name AS ticket_type, h.created_at, h.expires_at
         FROM checkouts h
         JOIN users u ON u.id = h.user_id
         LEFT JOIN ticket_types t ON t.id = h.ticket_type_id
         WHERE h.event_id = $1 AND h.method = 'direct' AND h.status = 'pending'
         ORDER BY h.created_at, h.id`,
        [eventId],
      );
      const now = Date.now();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        guest: r.guest,
        reference: r.reference,
        amountCents: r.amount_cents,
        currency: r.currency,
        ticketType: r.ticket_type,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        expired: r.expires_at.getTime() <= now,
      }));
    });
  }

  /**
   * The money arrived: the held place becomes theirs, and the ticket goes
   * by email. If the hold had run out, only while there's still room.
   */
  async confirm(access: ClubAccess, eventId: string, checkoutId: string): Promise<void> {
    const { orgId, registrationId } = await this.inClub(access, async (m, orgId) => {
      const held = await this.lockHeld(m, access, eventId, checkoutId);
      if (held.event_status !== 'published') {
        throw HttpError.conflict("This event isn't taking registrations any more", 'EVENT_NOT_OPEN');
      }
      if (held.ends_at <= new Date()) throw HttpError.conflict('This event has ended', 'EVENT_ENDED');
      const [going]: unknown[] = await m.query(
        `SELECT 1 FROM registrations WHERE event_id = $1 AND user_id = $2 AND cancelled_at IS NULL`,
        [eventId, held.user_id],
      );
      if (going) throw HttpError.conflict('They already have a place', 'ALREADY_REGISTERED');
      if (held.expires_at <= new Date()) await this.checkRoom(m, eventId, held);

      const row = await insertPlace(
        m,
        { orgId, eventId, userId: held.user_id },
        {
          ticket: { type: held.ticket_type_id ? { id: held.ticket_type_id } : null, discountCodeId: held.discount_code_id },
          answers: held.answers ?? {},
          payment: { amountCents: held.amount_cents, currency: held.currency, paymentIntentId: null, direct: true },
        },
      );
      await m.query(`UPDATE checkouts SET status = 'paid', registration_id = $2 WHERE id = $1`, [checkoutId, row.id]);
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventPaymentConfirmed,
        clubId: access.clubId,
        eventId,
        subjectUserId: held.user_id,
        details: { title: held.title, reference: held.reference, amountCents: held.amount_cents, currency: held.currency },
      });
      return { orgId, registrationId: row.id };
    });
    await this.payments.ticketFor(orgId, registrationId);
  }

  /** No payment came: the place they held is on offer again, and they're told. */
  async decline(access: ClubAccess, eventId: string, checkoutId: string): Promise<void> {
    const told = await this.inClub(access, async (m) => {
      const held = await this.lockHeld(m, access, eventId, checkoutId);
      await m.query(`UPDATE checkouts SET status = 'declined' WHERE id = $1`, [checkoutId]);
      await audit(m, {
        actorId: access.userId,
        action: AuditAction.EventPaymentDeclined,
        clubId: access.clubId,
        eventId,
        subjectUserId: held.user_id,
        details: { title: held.title, reference: held.reference },
      });
      const [row]: { email: string; name: string; guest: boolean; club_name: string; org_slug: string }[] = await m.query(
        `SELECT u.email, u.name, (u.password_hash IS NULL) AS guest, c.name AS club_name, o.slug AS org_slug
         FROM users u, clubs c JOIN organisations o ON o.id = c.org_id
         WHERE u.id = $1 AND c.id = $2`,
        [held.user_id, access.clubId],
      );
      return { ...row, title: held.title, reference: held.reference };
    });
    this.email.inBackground(
      'payment declined',
      this.email.sendPaymentDeclined({
        to: told.email,
        checkoutId,
        link: { guest: told.guest, orgSlug: told.org_slug, clubId: access.clubId, eventId },
        name: told.name,
        eventTitle: told.title,
        clubName: told.club_name,
        reference: told.reference,
      }),
    );
  }

  /** Someone changed their mind before paying: their held place goes back on offer. */
  async cancelMine(access: ClubAccess, eventId: string): Promise<void> {
    await this.inClub(access, async (m) => {
      const [cancelled]: [unknown[], number] = await m.query(
        `UPDATE checkouts SET status = 'expired'
         WHERE event_id = $1 AND user_id = $2 AND method = 'direct' AND status = 'pending'
           AND event_id IN (SELECT id FROM events WHERE club_id = $3)
         RETURNING id`,
        [eventId, access.userId, access.clubId],
      );
      if (cancelled.length === 0) throw paymentNotFound();
    });
  }

  // --- helpers -----------------------------------------------------------------------

  private async inClub<T>(access: ClubAccess, work: (m: EntityManager, orgId: string) => Promise<T>): Promise<T> {
    const orgId = await this.tenant.orgIdForClub(access.clubId);
    if (!orgId) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
    return this.tenant.withTenant(orgId, (m) => work(m, orgId));
  }

  // the event, in this club, and this person may edit it
  private async manageable(m: EntityManager, access: ClubAccess, eventId: string): Promise<void> {
    const [event]: { created_by: string | null; status: string }[] = await m.query(
      `SELECT created_by, status FROM events WHERE id = $1 AND club_id = $2`,
      [eventId, access.clubId],
    );
    if (!event) throw HttpError.notFound('Event not found', 'EVENT_NOT_FOUND');
    if (!mayManage(access, event.created_by)) throw missingPermission([Permission.EventManageAny]);
  }

  // a payment still waiting, with its event, both locked (so confirming can't race a decline, or the last seat)
  private async lockHeld(m: EntityManager, access: ClubAccess, eventId: string, checkoutId: string): Promise<HeldRow> {
    await this.manageable(m, access, eventId);
    const [held]: HeldRow[] = await m.query(
      `SELECT h.id, h.user_id, h.status, h.expires_at, h.amount_cents, h.currency, h.reference, h.answers,
              h.ticket_type_id, h.discount_code_id,
              e.status AS event_status, e.ends_at, e.capacity, e.created_by, e.title
       FROM checkouts h JOIN events e ON e.id = h.event_id
       WHERE h.id = $1 AND h.event_id = $2 AND h.method = 'direct'
       FOR UPDATE OF h, e`,
      [checkoutId, eventId],
    );
    if (!held) throw paymentNotFound();
    if (held.status !== 'pending') {
      throw HttpError.conflict(
        held.status === 'paid' ? 'This payment is already confirmed' : 'This payment was turned down or given up',
        'PAYMENT_NOT_PENDING',
      );
    }
    return held;
  }

  // its hold ran out, so the place may have gone: is there still one, of its ticket type?
  private async checkRoom(m: EntityManager, eventId: string, held: HeldRow): Promise<void> {
    if ((await freePlaces(m, eventId, held.capacity, held.user_id)) === 0) {
      throw HttpError.conflict('The event filled up after their hold ran out', 'EVENT_FULL');
    }
    if (!held.ticket_type_id) return;
    const [type]: { capacity: number | null; taken: number }[] = await m.query(
      `SELECT t.capacity,
              ((SELECT count(*) FROM registrations WHERE ticket_type_id = t.id AND cancelled_at IS NULL)
             + (SELECT count(*) FROM checkouts
                WHERE ticket_type_id = t.id AND status = 'pending' AND expires_at > now() AND user_id <> $2))::int AS taken
       FROM ticket_types t WHERE t.id = $1`,
      [held.ticket_type_id, held.user_id],
    );
    if (type && type.capacity !== null && type.taken >= type.capacity) {
      throw HttpError.conflict('That ticket sold out after their hold ran out', 'TICKET_TYPE_SOLD_OUT');
    }
  }
}

// (event.service's canManage; not imported from there, which would tie the two modules together)
function mayManage(access: ClubAccess, createdBy: string | null): boolean {
  return (
    access.has(Permission.EventManageAny) || (access.has(Permission.EventManageOwn) && createdBy === access.userId)
  );
}
