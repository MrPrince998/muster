import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { EVENT_EMAILS, type EventEmails, NotificationService } from './notification.service.js';

class EventEmailsDto {
  @ApiProperty({
    enum: EVENT_EMAILS,
    description: 'off: none. instant: an email as each event is published. weekly: a digest every Monday.',
  })
  @IsIn(EVENT_EMAILS)
  eventEmails: EventEmails;
}

class OptOutDto {
  /** From the link in the email */
  @IsString()
  @MaxLength(200)
  token: string;
}

class OptOutResultDto {
  @ApiProperty({ description: 'What stopped, to show the person' })
  stopped: string;
}

@ApiTags('event emails')
@Controller()
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /** Which new-event emails you get from this club */
  @Get('clubs/:clubId/event-emails')
  @RequirePermission()
  @ApiOkResponse({ type: EventEmailsDto })
  async get(@CurrentClubAccess() access: ClubAccess): Promise<EventEmailsDto> {
    return { eventEmails: await this.notifications.preference(access) };
  }

  /** Choose which new-event emails you get from this club */
  @Put('clubs/:clubId/event-emails')
  @RequirePermission()
  @ApiOkResponse({ type: EventEmailsDto })
  async set(@CurrentClubAccess() access: ClubAccess, @Body() { eventEmails }: EventEmailsDto): Promise<EventEmailsDto> {
    return { eventEmails: await this.notifications.setPreference(access, eventEmails) };
  }

  /**
   * Stop new-event emails, from the link in one
   *
   * @remarks No sign-in: the token in the link is the proof. From a club's
   * email it turns that club off; from a digest, the weekly digest.
   */
  @Public()
  @Post('public/event-emails/off')
  @UseGuards(ThrottlerGuard)
  // generous: one-click stops from mail providers all arrive through the web server's one address,
  // and the link is an HMAC, so there's nothing to guess at
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OptOutResultDto })
  @ApiBadRequestResponse({ description: 'A wrong link (INVALID_TOKEN)', type: ErrorResponseDto })
  optOut(@Body() { token }: OptOutDto): Promise<OptOutResultDto> {
    return this.notifications.optOut(token);
  }
}
