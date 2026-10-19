import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { Permission } from '../permission/permissions.js';
import { FeedbackFormDto, FeedbackSummaryDto, GiveFeedbackDto } from './dto/feedback.dto.js';
import { FeedbackService } from './feedback.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('feedback')
@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** The "how was it?" form behind an emailed link: which event, and the answer so far */
  @Public()
  @Get('public/feedback/:token')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOkResponse({ type: FeedbackFormDto })
  @ApiNotFoundResponse(error('A wrong link, or not someone who came (FEEDBACK_NOT_FOUND)'))
  form(@Param('token') token: string): Promise<FeedbackFormDto> {
    return this.feedback.form(token);
  }

  /** Answer (or change the answer): a rating out of five, and a comment if you like */
  @Public()
  @Put('public/feedback/:token')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({ type: FeedbackFormDto })
  @ApiNotFoundResponse(error('A wrong link (FEEDBACK_NOT_FOUND)'))
  @ApiConflictResponse(error('More than a month after the event (FEEDBACK_CLOSED)'))
  give(@Param('token') token: string, @Body() dto: GiveFeedbackDto): Promise<FeedbackFormDto> {
    return this.feedback.give(token, dto);
  }

  /** What people thought of an event, without names */
  @Get('clubs/:clubId/events/:eventId/feedback')
  @RequirePermission(Permission.AnalyticsView)
  @ApiOkResponse({ type: FeedbackSummaryDto })
  @ApiNotFoundResponse(error('No such event (EVENT_NOT_FOUND)'))
  summary(
    @CurrentClubAccess() access: ClubAccess,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<FeedbackSummaryDto> {
    return this.feedback.summary(access, eventId);
  }
}
