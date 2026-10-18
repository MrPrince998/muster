import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { Permission } from '../permission/permissions.js';
import { CreateEventDto, EventAttendeeDto, EventDto, ListEventsQuery, UpdateEventDto } from './dto/event.dto.js';
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
   * created. Fields left out keep their value.
   */
  @Patch(':eventId')
  @RequirePermission()
  @ApiOkResponse({ type: EventDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(error('Capacity below the people already registered (CAPACITY_BELOW_REGISTERED)'))
  update(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateEventDto,
  ): Promise<EventDto> {
    return this.events.update(access, eventId, dto);
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
  ): Promise<EventDto> {
    return this.events.publish(access, eventId);
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
