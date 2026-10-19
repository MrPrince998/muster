import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { AnswersDto, MyRegistrationDto } from '../event/dto/event.dto.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { RegistrationService } from './registration.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('registrations')
@Controller('clubs/:clubId/events/:eventId/my-registration')
export class RegistrationController {
  constructor(private readonly registrations: RegistrationService) {}

  /**
   * Register for an event
   *
   * @remarks Any club member, while the event is published and hasn't
   * ended, and a place is free.
   */
  @Post()
  @RequirePermission()
  @ApiCreatedResponse({ type: MyRegistrationDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  @ApiConflictResponse(
    error('Full (EVENT_FULL), ended (EVENT_ENDED), not open (EVENT_NOT_OPEN) or already registered (ALREADY_REGISTERED)'),
  )
  register(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() { answers }: AnswersDto,
  ): Promise<MyRegistrationDto> {
    return this.registrations.register(access, eventId, answers);
  }

  /** Cancel your registration and free the place */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission()
  @ApiNoContentResponse({ description: 'Cancelled' })
  @ApiNotFoundResponse(error('Not registered (REGISTRATION_NOT_FOUND)'))
  @ApiConflictResponse(error('Already checked in (ALREADY_CHECKED_IN)'))
  cancel(@CurrentClubAccess() access: ClubAccess, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<void> {
    return this.registrations.cancel(access, eventId);
  }
}
