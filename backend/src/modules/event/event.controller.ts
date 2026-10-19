import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { Permission } from '../permission/permissions.js';
import {
  CancelEventDto,
  CreateEventDto,
  EventAttendeeDto,
  EventDto,
  ListEventsQuery,
  SeriesScopeQuery,
  UpdateEventDto,
} from './dto/event.dto.js';
import { EventService } from './event.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('events')
@Controller('clubs/:clubId/events')
export class EventController {
  constructor(private readonly events: EventService) {}

  /** A club's events: upcoming, past, or your drafts */
  @Get()
  @RequirePermission()
  @ApiOkResponse({ type: [EventDto] })
  list(@CurrentClubAccess() access: ClubAccess, @Query() { scope }: ListEventsQuery): Promise<EventDto[]> {
    return this.events.list(access, scope ?? 'upcoming');
  }

  /**
   * Create an event
   *
   * @remarks Saved as a draft unless `publish` is true, which also needs
   * event.publish.
   */
  @Post()
  @RequirePermission(Permission.EventCreate)
  @ApiCreatedResponse({ type: EventDto })
  @ApiBadRequestResponse(error('Invalid input, or ends before it starts (EVENT_ENDS_BEFORE_START)'))
  create(@CurrentClubAccess() access: ClubAccess, @Body() dto: CreateEventDto): Promise<EventDto> {
    return this.events.create(access, dto);
  }

  /** One event */
  @Get(':eventId')
  @RequirePermission()
  @ApiOkResponse({ type: EventDto })
  @ApiNotFoundResponse(error('No such event in this club, or a draft you cannot see (EVENT_NOT_FOUND)'))
  findOne(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventDto> {
    return this.events.inClub(access, (m) => this.events.findOne(m, access, eventId));
  }

  /**
   * Edit an event
   *
   * @remarks Needs event.manage_any, or event.manage_own for events you
   * created. Fields left out keep their value. A new time or place on a
   * published event is emailed to everyone registered.
   */
  @Patch(':eventId')
  @RequirePermission()
  @ApiOkResponse({ type: EventDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(
    error('Capacity below the people already registered (CAPACITY_BELOW_REGISTERED), or cancelled (EVENT_CANCELLED)'),
  )
  update(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateEventDto,
    @Query() { scope }: SeriesScopeQuery,
  ): Promise<EventDto> {
    return this.events.update(access, eventId, dto, scope);
  }

  /** Publish a draft: it becomes visible and open for registration */
  @Post(':eventId/publish')
  @RequirePermission(Permission.EventPublish)
  @ApiCreatedResponse({ type: EventDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(error('Already published (EVENT_NOT_DRAFT)'))
  publish(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() { scope }: SeriesScopeQuery,
  ): Promise<EventDto> {
    return this.events.publish(access, eventId, scope);
  }

  /**
   * Cancel a published event
   *
   * @remarks Same permission as editing it. The event stays listed as
   * cancelled, its tickets stop working, and everyone registered is emailed
   * (with the reason, if given).
   */
  @Post(':eventId/cancel')
  @RequirePermission()
  @ApiCreatedResponse({ type: EventDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(
    error('A draft (EVENT_IS_DRAFT), already cancelled (EVENT_ALREADY_CANCELLED) or over (EVENT_ENDED)'),
  )
  cancel(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CancelEventDto,
    @Query() { scope }: SeriesScopeQuery,
  ): Promise<EventDto> {
    return this.events.cancel(access, eventId, dto, scope);
  }

  /**
   * Delete a draft
   *
   * @remarks Same permission as editing it. Published events are cancelled
   * instead, so their history stays.
   */
  @Delete(':eventId')
  @RequirePermission()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(error('Not a draft (EVENT_NOT_DRAFT)'))
  remove(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() { scope }: SeriesScopeQuery,
  ): Promise<void> {
    return this.events.remove(access, eventId, scope);
  }

  /** The event as a calendar file (.ics), for "Add to calendar" */
  @Get(':eventId/calendar')
  @RequirePermission()
  @ApiOkResponse({ description: 'An iCalendar file', content: { 'text/calendar': { schema: { type: 'string' } } } })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  async calendar(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, ics } = await this.events.calendar(access, eventId);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return ics;
  }

  /**
   * The attendee list, as a spreadsheet (CSV)
   *
   * @remarks Needs registration.view, like the list itself. Names, status
   * (going, checked in, waitlist position), times in the workspace's zone,
   * and whether each person is from outside the workspace. No emails.
   */
  @Get(':eventId/registrations/export')
  @RequirePermission(Permission.RegistrationView)
  @ApiOkResponse({ description: 'A CSV file', content: { 'text/csv': { schema: { type: 'string' } } } })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  async exportAttendees(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, csv } = await this.events.attendeesCsv(access, eventId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // a list of people: never kept by a browser cache or a proxy
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }

  /** Who's going */
  @Get(':eventId/registrations')
  @RequirePermission(Permission.RegistrationView)
  @ApiOkResponse({ type: [EventAttendeeDto] })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  attendees(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventAttendeeDto[]> {
    return this.events.attendees(access, eventId);
  }
}
