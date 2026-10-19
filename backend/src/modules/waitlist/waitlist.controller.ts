import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { EntityManager } from 'typeorm';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { HttpError } from '../../common/errors/http-error.js';
import { TenantService } from '../../database/tenant.service.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { AnswersDto } from '../event/dto/event.dto.js';
import { checkAnswers } from '../event/questions.js';
import { freePlaces, lockEvent, waitingCount, WaitlistService } from './waitlist.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

export class WaitlistPositionDto {
  @ApiProperty({ description: 'Your place in the queue, from 1' })
  position: number;
}

/** A member's place in an event's waitlist. */
@ApiTags('waitlist')
@Controller('clubs/:clubId/events/:eventId/waitlist')
export class WaitlistController {
  constructor(
    private readonly tenant: TenantService,
    private readonly waitlist: WaitlistService,
  ) {}

  /**
   * Join the waitlist
   *
   * @remarks Only when the event is full (or others are already waiting).
   * When a place frees up, the longest-waiting person gets it, and their
   * ticket by email.
   */
  @Post()
  @RequirePermission()
  @ApiCreatedResponse({ type: WaitlistPositionDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(
    error(
      'A place is free: register instead (PLACES_AVAILABLE); registered already (ALREADY_REGISTERED); not open (EVENT_NOT_OPEN, EVENT_ENDED, REGISTRATION_CLOSED)',
    ),
  )
  join(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() { answers }: AnswersDto,
  ): Promise<WaitlistPositionDto> {
    return this.inClub(access, async (m, orgId) => {
      const event = await lockEvent(m, eventId, access.clubId);
      if (!event || event.status === 'draft') throw HttpError.notFound('Event not found', 'EVENT_NOT_FOUND');
      if (event.status !== 'published') throw HttpError.conflict('This event is not open for registration', 'EVENT_NOT_OPEN');
      if (event.ends_at <= new Date()) throw HttpError.conflict('This event has ended', 'EVENT_ENDED');
      if (event.registration_closed_at !== null) {
        throw HttpError.conflict('Registration for this event is closed', 'REGISTRATION_CLOSED');
      }
      const free = await freePlaces(m, eventId, event.capacity);
      if (free !== 0 && (await waitingCount(m, eventId)) === 0) {
        throw HttpError.conflict('There is a place free: register instead', 'PLACES_AVAILABLE');
      }
      // a place freed at a paid event is bought by whoever's first, not handed down a queue
      if (event.price_cents !== null) throw HttpError.conflict('This event is sold out', 'SOLD_OUT');
      const checked = checkAnswers(event.questions ?? [], answers);
      return { position: await this.waitlist.join(m, { orgId, eventId, userId: access.userId, answers: checked }) };
    });
  }

  /** Leave the waitlist */
  @Delete()
  @RequirePermission()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Left' })
  @ApiNotFoundResponse(error('Not waiting (NOT_WAITLISTED)'))
  leave(@CurrentClubAccess() access: ClubAccess, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<void> {
    return this.inClub(access, async (m) => {
      const event = await lockEvent(m, eventId, access.clubId);
      if (!event) throw HttpError.notFound('Event not found', 'EVENT_NOT_FOUND');
      await this.waitlist.leave(m, eventId, access.userId);
    });
  }

  private async inClub<T>(access: ClubAccess, work: (m: EntityManager, orgId: string) => Promise<T>) {
    const orgId = await this.tenant.orgIdForClub(access.clubId);
    if (!orgId) throw HttpError.notFound('Club not found', 'CLUB_NOT_FOUND');
    return this.tenant.withTenant(orgId, (m) => work(m, orgId));
  }
}
