import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { ApiConflictResponse, ApiExcludeEndpoint, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
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

class PaymentStatusDto {
  @ApiProperty({ description: 'This Muster takes payments at all' })
  available: boolean;

  @ApiProperty({ description: 'The workspace has started connecting a Stripe account' })
  connected: boolean;

  @ApiProperty({ description: 'Stripe says it can take payments: events can have a price' })
  ready: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Its tickets' currency (ISO 4217, lowercase)" })
  currency: string | null;
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
}

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('payments')
@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

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
   * Stripe says it's paid. If it comes to nothing, the place is yours now.
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
