import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { Permission } from '../permission/permissions.js';
import {
  CheckInDto,
  CheckInResultDto,
  DoorRosterDto,
  ManualCheckInDto,
  OfflineCheckInsDto,
  SyncResultDto,
  TicketDto,
  TicketWithCodeDto,
} from './dto/ticket.dto.js';
import { RegistrationService } from './registration.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('tickets')
@Controller()
export class TicketController {
  constructor(private readonly registrations: RegistrationService) {}

  /** Your tickets everywhere: events that haven't ended, soonest first */
  @Get('me/tickets')
  @ApiOkResponse({ type: [TicketDto] })
  myTickets(@CurrentUser() user: AuthUser): Promise<TicketDto[]> {
    return this.registrations.myTickets(user);
  }

  /** Your ticket for an event, with its QR code */
  @Get('clubs/:clubId/events/:eventId/my-ticket')
  @RequirePermission()
  @ApiOkResponse({ type: TicketWithCodeDto })
  @ApiNotFoundResponse(error('Not registered (TICKET_NOT_FOUND)'))
  myTicket(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<TicketWithCodeDto> {
    return this.registrations.myTicket(access, eventId);
  }

  /**
   * Check in a scanned ticket
   *
   * @remarks Always answers 200 with an outcome the door can act on:
   * checked_in, already_checked_in (with when and by whom), cancelled,
   * wrong_event or invalid. A ticket gets in exactly once, however many
   * scanners read it at the same time.
   */
  @Post('clubs/:clubId/events/:eventId/check-in')
  @RequirePermission(Permission.CheckinScan)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CheckInResultDto })
  @ApiNotFoundResponse(error('No such event in this club (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(error('The event was cancelled (EVENT_CANCELLED)'))
  checkIn(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() { token }: CheckInDto,
  ): Promise<CheckInResultDto> {
    return this.registrations.checkIn(access, eventId, token);
  }

  /** Check someone in by name, when their ticket can't be scanned */
  @Post('clubs/:clubId/events/:eventId/check-in/manual')
  @RequirePermission(Permission.CheckinScan)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CheckInResultDto })
  @ApiNotFoundResponse(error('No such event in this club (EVENT_NOT_FOUND)'))
  manualCheckIn(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() { userId }: ManualCheckInDto,
  ): Promise<CheckInResultDto> {
    return this.registrations.manualCheckIn(access, eventId, userId);
  }

  /**
   * The door's list, for checking tickets with no connection
   *
   * @remarks Every ticket's registration id, name, and whether it's used or
   * given back. A scanner keeps it, checks codes against it while offline,
   * and sends what it let in to the sync route once it's back.
   */
  @Get('clubs/:clubId/events/:eventId/check-in/roster')
  @RequirePermission(Permission.CheckinScan)
  @ApiOkResponse({ type: DoorRosterDto })
  @ApiNotFoundResponse(error('No such event in this club (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(error('The event was cancelled (EVENT_CANCELLED)'))
  roster(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<DoorRosterDto> {
    return this.registrations.roster(access, eventId);
  }

  /**
   * Send the check-ins a scanner made offline
   *
   * @remarks Each is checked in as a scan would be, at the time the door
   * saw it. A ticket someone else used first comes back already_checked_in.
   */
  @Post('clubs/:clubId/events/:eventId/check-in/sync')
  @RequirePermission(Permission.CheckinScan)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SyncResultDto })
  @ApiNotFoundResponse(error('No such event in this club (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(error('The event was cancelled (EVENT_CANCELLED)'))
  sync(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() { checkIns }: OfflineCheckInsDto,
  ): Promise<SyncResultDto> {
    return this.registrations.syncCheckIns(access, eventId, checkIns);
  }
}
