import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { ConfirmGuestPlaceDto, GuestPlaceDto, GuestPlaceResultDto, PublicEventDto } from './dto/public.dto.js';
import { TicketWithCodeDto } from './dto/ticket.dto.js';
import { GuestService } from './guest.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });
const closed = error('Cancelled or not open (EVENT_NOT_OPEN), over (EVENT_ENDED), closed (REGISTRATION_CLOSED) or full (EVENT_FULL)');

/**
 * No sign-in: public events and guest tickets. Rate limited per client, and
 * nothing here can reach a draft or a members-only event.
 */
@ApiTags('public')
@Public()
@UseGuards(ThrottlerGuard)
@ApiTooManyRequestsResponse(error('Too many attempts; try again in a minute'))
@Controller('public')
export class PublicController {
  constructor(private readonly guests: GuestService) {}

  /** A public event, as anyone with the link sees it */
  @Get('events/:eventId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOkResponse({ type: PublicEventDto })
  @ApiNotFoundResponse(error('No such public event (EVENT_NOT_FOUND)'))
  event(@Param('eventId', ParseUUIDPipe) eventId: string): Promise<PublicEventDto> {
    return this.guests.event(eventId);
  }

  /** A public event as a calendar file (.ics): "Add to calendar" for anyone with the link */
  @Get('events/:eventId/calendar')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOkResponse({ description: 'An iCalendar file', content: { 'text/calendar': { schema: { type: 'string' } } } })
  @ApiNotFoundResponse(error('No such public event (EVENT_NOT_FOUND)'))
  async calendar(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, ics } = await this.guests.calendar(eventId);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return ics;
  }

  /**
   * Ask for a place as a guest
   *
   * @remarks Emails a link to confirm it; the place is only taken when it's
   * used. The same answer whatever the address.
   */
  @Post('events/:eventId/places')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Confirmation link sent' })
  @ApiNotFoundResponse(error('No such public event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(closed)
  requestPlace(@Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: GuestPlaceDto): Promise<void> {
    return this.guests.requestPlace(eventId, dto);
  }

  /** Confirm a place from the emailed link; the ticket is emailed too */
  @Post('events/:eventId/places/confirm')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GuestPlaceResultDto })
  @ApiBadRequestResponse(error('A wrong or expired link (INVALID_TOKEN)'))
  @ApiConflictResponse(closed)
  confirm(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() { token }: ConfirmGuestPlaceDto,
  ): Promise<GuestPlaceResultDto> {
    return this.guests.confirmPlace(eventId, token);
  }

  /** A ticket, opened by its own signed token (a guest's way in) */
  @Get('tickets/:token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOkResponse({ type: TicketWithCodeDto })
  @ApiNotFoundResponse(error('Cancelled, or not a ticket (TICKET_NOT_FOUND)'))
  ticket(@Param('token') token: string): Promise<TicketWithCodeDto> {
    return this.guests.ticket(token);
  }

  /** Give the place back, from the ticket's page */
  @Post('tickets/:token/cancel')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Place given back' })
  @ApiNotFoundResponse(error('Cancelled already, or not a ticket (TICKET_NOT_FOUND)'))
  @ApiConflictResponse(error('Checked in already (ALREADY_CHECKED_IN)'))
  cancel(@Param('token') token: string): Promise<void> {
    return this.guests.cancelTicket(token);
  }
}
