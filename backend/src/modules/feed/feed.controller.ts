import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { FeedService } from './feed.service.js';

class FeedTokenDto {
  @ApiProperty({ description: 'The secret part of your feed links: /feeds/{token}/clubs/{clubId}.ics' })
  token: string;
}

@ApiTags('calendar feeds')
@Controller()
export class FeedController {
  constructor(private readonly feeds: FeedService) {}

  /** Your calendar feed token, for subscribing to clubs' events */
  @Get('me/calendar-feed')
  @ApiOkResponse({ type: FeedTokenDto })
  async token(@CurrentUser() user: AuthUser): Promise<FeedTokenDto> {
    return { token: await this.feeds.token(user.id) };
  }

  /** A new feed token: every link made with the old one stops working */
  @Post('me/calendar-feed/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FeedTokenDto })
  async reset(@CurrentUser() user: AuthUser): Promise<FeedTokenDto> {
    return { token: await this.feeds.reset(user.id) };
  }

  /**
   * A club's events as a calendar feed
   *
   * @remarks For calendar apps: no sign-in, the token in the link is the
   * proof. Only for members of the club; anything else is not found.
   */
  @Public()
  @Get('feeds/:token/clubs/:file')
  @ApiOkResponse({ description: 'An iCalendar feed', content: { 'text/calendar': { schema: { type: 'string' } } } })
  @ApiNotFoundResponse({ description: 'Wrong or reset link, or not in the club (FEED_NOT_FOUND)', type: ErrorResponseDto })
  async club(
    @Param('token') token: string,
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const ics = await this.feeds.clubFeed(token, file.replace(/\.ics$/, ''));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="muster.ics"');
    // a few minutes' grace for calendar servers; private, it's one person's link
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Robots-Tag', 'noindex');
    return ics;
  }
}
