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
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
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
  CreateDiscountCodeDto,
  DiscountCodeDto,
  EventMessageDto,
  ListEventsQuery,
  AttendeesPageDto,
  AttendeesQuery,
  PastEventsPageDto,
  PastEventsQuery,
  UpdateDiscountCodeDto,
  SendEventMessageDto,
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
   * A club's past events, a page at a time
   *
   * @remarks Latest first. Pass `next` as `before` for the following page.
   */
  @Get('past')
  @RequirePermission()
  @ApiOkResponse({ type: PastEventsPageDto })
  @ApiBadRequestResponse(error('A wrong page cursor (INVALID_CURSOR)'))
  past(@CurrentClubAccess() access: ClubAccess, @Query() query: PastEventsQuery): Promise<PastEventsPageDto> {
    return this.events.pastPage(access, query);
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

  /**
   * Message everyone going
   *
   * @remarks Same permission as editing it. Emails everyone with a place
   * (and the waitlist, with toWaitlist), and keeps the message. Ten a day.
   */
  @Post(':eventId/messages')
  @RequirePermission()
  @ApiCreatedResponse({ type: EventMessageDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(error('A draft (EVENT_IS_DRAFT), nobody going (NO_RECIPIENTS), or too many today (TOO_MANY_MESSAGES)'))
  message(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SendEventMessageDto,
  ): Promise<EventMessageDto> {
    return this.events.message(access, eventId, dto);
  }

  /**
   * Set the event's cover image
   *
   * @remarks Same permission as editing it. The request body is the image
   * itself (Content-Type image/webp, image/jpeg or image/png), 2 MB at most.
   */
  @Put(':eventId/cover')
  @RequirePermission()
  @ApiConsumes('image/webp', 'image/jpeg', 'image/png')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: EventDto })
  @ApiBadRequestResponse(error('Not an image we take (IMAGE_NOT_SUPPORTED), or over 2 MB (IMAGE_TOO_LARGE)'))
  setCover(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() image: unknown,
  ): Promise<EventDto> {
    return this.events.setCover(access, eventId, image);
  }

  /** Take the cover image off */
  @Delete(':eventId/cover')
  @RequirePermission()
  @ApiOkResponse({ type: EventDto })
  removeCover(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventDto> {
    return this.events.removeCover(access, eventId);
  }

  /** An event's discount codes, with their uses */
  @Get(':eventId/discount-codes')
  @RequirePermission()
  @ApiOkResponse({ type: [DiscountCodeDto] })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  discountCodes(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<DiscountCodeDto[]> {
    return this.events.discountCodes(access, eventId);
  }

  /**
   * Make a discount code
   *
   * @remarks Same permission as editing the event. A percentage or an
   * amount off its paid tickets, with an optional limit and end.
   */
  @Post(':eventId/discount-codes')
  @RequirePermission()
  @ApiCreatedResponse({ type: [DiscountCodeDto] })
  @ApiConflictResponse(error('The event has that code already (CODE_TAKEN)'))
  createDiscountCode(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateDiscountCodeDto,
  ): Promise<DiscountCodeDto[]> {
    return this.events.createDiscountCode(access, eventId, dto);
  }

  /** Turn a discount code on or off */
  @Patch(':eventId/discount-codes/:codeId')
  @RequirePermission()
  @ApiOkResponse({ type: [DiscountCodeDto] })
  @ApiNotFoundResponse(error('No such code (CODE_NOT_FOUND)'))
  setDiscountCode(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('codeId', ParseUUIDPipe) codeId: string,
    @Body() { active }: UpdateDiscountCodeDto,
  ): Promise<DiscountCodeDto[]> {
    return this.events.setDiscountCodeActive(access, eventId, codeId, active);
  }

  /** What's been sent to the people going, newest first */
  @Get(':eventId/messages')
  @RequirePermission()
  @ApiOkResponse({ type: [EventMessageDto] })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  messages(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventMessageDto[]> {
    return this.events.messages(access, eventId);
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
  @ApiOkResponse({ type: AttendeesPageDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiBadRequestResponse(error('A wrong page cursor (INVALID_CURSOR)'))
  attendees(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: AttendeesQuery,
  ): Promise<AttendeesPageDto> {
    return this.events.attendees(access, eventId, query);
  }
}
