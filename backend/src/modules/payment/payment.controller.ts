import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { CurrentOrgMember } from '../organisation/decorators/current-org-member.decorator.js';
import { RequireOrgRole } from '../organisation/decorators/require-org-role.decorator.js';
import { OrgRole } from '../organisation/entities/org-member.entity.js';
import type { OrgMembership } from '../organisation/org-roles.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { GetTicketDto } from '../event/dto/event.dto.js';
import { PaymentService } from './payment.service.js';
import { DirectPaymentService } from './direct-payment.service.js';
import { DirectPaymentDto, PendingDirectPaymentDto, UpdatePaymentSettingsDto } from './dto/direct-payment.dto.js';

class DirectSettingsDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  currency: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'How to pay, in their words' })
  instructions: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Their payment QR code, a path on the API (/files/...)' })
  qrUrl: string | null;

  @ApiProperty({ description: 'How long a place waits for its payment' })
  holdHours: number;
}

class PaymentStatusDto {
  @ApiProperty({ description: 'This Muster offers Stripe; paying the organisers directly is always on offer' })
  available: boolean;

  @ApiProperty({ enum: ['stripe', 'direct'], description: 'How buyers pay: through Stripe, or to the organisers directly' })
  method: 'stripe' | 'direct';

  @ApiProperty({ description: 'The workspace has started connecting a Stripe account' })
  connected: boolean;

  @ApiProperty({ description: 'Events can have a price: Stripe can take payments, or the workspace has said how to pay it directly' })
  ready: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Its tickets' currency (ISO 4217, lowercase)" })
  currency: string | null;

  @ApiProperty({ type: DirectSettingsDto })
  direct: DirectSettingsDto;
}

class RedirectDto {
  @ApiProperty({ description: 'Where to send the browser' })
  url: string;
}

class GetTicketResultDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: "Stripe's checkout page; null when the place is already yours" })
  url: string | null;

  @ApiProperty({ description: 'It came to nothing (a free ticket, or a code), so the place is yours now' })
  registered: boolean;

  @ApiPropertyOptional({
    type: DirectPaymentDto,
    nullable: true,
    description: 'The organisers are paid directly: the place is held, and this is how to pay for it (also emailed)',
  })
  payment: DirectPaymentDto | null;
}

class PaymentModeDto {
  @ApiProperty({ description: 'Tickets can be sold at all (Stripe is set up)' })
  enabled: boolean;

  @ApiProperty({ description: "No real money moves: Stripe's test keys, so checkout takes test cards like 4242 4242 4242 4242" })
  testMode: boolean;
}

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('payments')
@Controller()
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly direct: DirectPaymentService,
  ) {}

  /** Whether payments are on, and whether they're real or test ones (anyone, signed in or not) */
  @Public()
  @Get('payments/mode')
  @ApiOkResponse({ type: PaymentModeDto })
  mode(): PaymentModeDto {
    return this.payments.mode();
  }

  /** Whether the workspace can sell tickets */
  @Get('orgs/:orgId/payments')
  @RequireOrgRole(OrgRole.Member)
  @ApiOkResponse({ type: PaymentStatusDto })
  status(@CurrentOrgMember() me: OrgMembership): Promise<PaymentStatusDto> {
    return this.payments.status(me);
  }

  /**
   * Connect (or finish connecting) the workspace's Stripe account
   *
   * @remarks Owner and admins. Returns Stripe's own sign-up page, which
   * comes back to Settings. Ticket money goes to this account.
   */
  @Post('orgs/:orgId/payments/connect')
  @RequireOrgRole(OrgRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RedirectDto })
  connect(@CurrentOrgMember() me: OrgMembership): Promise<RedirectDto> {
    return this.payments.connect(me);
  }

  /** Ask Stripe again whether the account can take payments */
  @Post('orgs/:orgId/payments/refresh')
  @RequireOrgRole(OrgRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PaymentStatusDto })
  refresh(@CurrentOrgMember() me: OrgMembership): Promise<PaymentStatusDto> {
    return this.payments.refresh(me);
  }

  /**
   * Choose how buyers pay
   *
   * @remarks Owner and admins. Through Stripe (where this Muster has it), or
   * to the organisers directly: their own instructions (eSewa, Khalti, a
   * bank account, cash), a currency, and how long a place waits for its
   * payment. Muster never holds the money either way.
   */
  @Patch('orgs/:orgId/payments')
  @RequireOrgRole(OrgRole.Admin)
  @ApiOkResponse({ type: PaymentStatusDto })
  @ApiBadRequestResponse(error('Paying directly needs instructions and a currency (DIRECT_DETAILS_REQUIRED)'))
  update(@CurrentOrgMember() me: OrgMembership, @Body() dto: UpdatePaymentSettingsDto): Promise<PaymentStatusDto> {
    return this.direct.update(me, dto);
  }

  /**
   * Set the workspace's payment QR code
   *
   * @remarks Owner and admins. The body is the image itself (image/webp,
   * image/jpeg or image/png), 2 MB at most. Shown, and emailed, to people
   * paying directly.
   */
  @Put('orgs/:orgId/payments/qr')
  @RequireOrgRole(OrgRole.Admin)
  @ApiConsumes('image/webp', 'image/jpeg', 'image/png')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: PaymentStatusDto })
  @ApiBadRequestResponse(error('Not an image we take (IMAGE_NOT_SUPPORTED), or over 2 MB (IMAGE_TOO_LARGE)'))
  setQr(@CurrentOrgMember() me: OrgMembership, @Body() image: unknown): Promise<PaymentStatusDto> {
    return this.direct.setQr(me, image);
  }

  /** Take the payment QR code off */
  @Delete('orgs/:orgId/payments/qr')
  @RequireOrgRole(OrgRole.Admin)
  @ApiOkResponse({ type: PaymentStatusDto })
  removeQr(@CurrentOrgMember() me: OrgMembership): Promise<PaymentStatusDto> {
    return this.direct.removeQr(me);
  }

  /** A link into the workspace's Stripe dashboard: payouts, payments, refunds */
  @Post('orgs/:orgId/payments/dashboard')
  @RequireOrgRole(OrgRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RedirectDto })
  dashboard(@CurrentOrgMember() me: OrgMembership): Promise<RedirectDto> {
    return this.payments.dashboard(me);
  }

  /**
   * Get a ticket at an event with ticket types
   *
   * @remarks Picks the type (ticketTypeId, needed when more than one is on
   * offer) and any discount code. If it costs something, holds a place for
   * half an hour and returns Stripe's checkout page; the ticket comes once
   * Stripe says it's paid. Where the organisers are paid directly, the place
   * is held for their hold time instead, with how to pay (`payment`); the
   * ticket comes once they confirm it. If it comes to nothing, the place is
   * yours now.
   */
  @Post('clubs/:clubId/events/:eventId/checkout')
  @RequirePermission()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetTicketResultDto })
  @ApiConflictResponse(
    error('Full (EVENT_FULL, TICKET_TYPE_SOLD_OUT), sales over (TICKET_SALES_ENDED), no types (EVENT_IS_FREE), registered already, or payments not set up'),
  )
  checkout(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() { answers, ticketTypeId, code }: GetTicketDto,
  ): Promise<GetTicketResultDto> {
    return this.payments.memberCheckout(access, eventId, answers, { ticketTypeId, code });
  }

  /** Give up a place held while you pay the organisers, before paying */
  @Delete('clubs/:clubId/events/:eventId/checkout')
  @RequirePermission()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  cancelCheckout(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<void> {
    return this.direct.cancelMine(access, eventId);
  }

  /**
   * Payments to confirm
   *
   * @remarks People who can edit the event. Places held while people pay
   * the organisers directly, oldest first, with each one's reference;
   * including those whose hold ran out, in case they paid late.
   */
  @Get('clubs/:clubId/events/:eventId/direct-payments')
  @RequirePermission()
  @ApiOkResponse({ type: [PendingDirectPaymentDto] })
  pendingPayments(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<PendingDirectPaymentDto[]> {
    return this.direct.pending(access, eventId);
  }

  /**
   * The money arrived
   *
   * @remarks The held place becomes theirs, and the ticket goes by email.
   * A hold that ran out is confirmed only while there's still room.
   */
  @Post('clubs/:clubId/events/:eventId/direct-payments/:checkoutId/confirm')
  @RequirePermission()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiConflictResponse(error('Already decided (PAYMENT_NOT_PENDING), the event is over or off, or (a hold that ran out) full'))
  confirmPayment(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('checkoutId', ParseUUIDPipe) checkoutId: string,
  ): Promise<void> {
    return this.direct.confirm(access, eventId, checkoutId);
  }

  /** No payment came: the held place is on offer again, and they're told by email */
  @Post('clubs/:clubId/events/:eventId/direct-payments/:checkoutId/decline')
  @RequirePermission()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiConflictResponse(error('Already decided (PAYMENT_NOT_PENDING)'))
  declinePayment(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('checkoutId', ParseUUIDPipe) checkoutId: string,
  ): Promise<void> {
    return this.direct.decline(access, eventId, checkoutId);
  }

  /** Stripe's webhooks: signed, so only Stripe's are acted on */
  @Public()
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string): Promise<{ received: true }> {
    await this.payments.webhook(req.rawBody, signature);
    return { received: true };
  }
}
