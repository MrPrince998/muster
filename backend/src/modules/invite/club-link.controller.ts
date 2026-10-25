import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { ClubLinkJoinResultDto, ClubLinkPreviewDto, JoinClubDto } from './dto/invite.dto.js';
import { InviteService } from './invite.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

/**
 * A club's own link, /c/{workspace}/{club}: not a secret like an invite
 * link, so it follows the club's and the workspace's join settings.
 */
@ApiTags('club links')
@Controller('club-links/:orgSlug/:clubSlug')
export class ClubLinkController {
  constructor(private readonly invites: InviteService) {}

  /** Where a club's link leads, and whether you're in */
  @Get()
  @ApiOkResponse({ type: ClubLinkPreviewDto })
  @ApiNotFoundResponse(error('No such club, or invite links only (CLUB_NOT_FOUND)'))
  preview(
    @CurrentUser() user: AuthUser,
    @Param('orgSlug') orgSlug: string,
    @Param('clubSlug') clubSlug: string,
  ): Promise<ClubLinkPreviewDto> {
    return this.invites.clubLinkPreview(user, orgSlug, clubSlug);
  }

  /**
   * Join the club (and its workspace), or ask to
   *
   * @remarks Outside the workspace, an open workspace lets you in with the
   * club; one that asks takes a request to join it first
   * (`workspace_requested`).
   */
  @Post('join')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ClubLinkJoinResultDto })
  @ApiNotFoundResponse(error('No such club, or invite links only (CLUB_NOT_FOUND)'))
  @ApiConflictResponse(error('In it already (ALREADY_IN_CLUB), or already asked the workspace (REQUEST_PENDING)'))
  join(
    @CurrentUser() user: AuthUser,
    @Param('orgSlug') orgSlug: string,
    @Param('clubSlug') clubSlug: string,
    @Body() { message }: JoinClubDto,
  ): Promise<ClubLinkJoinResultDto> {
    return this.invites.joinByClubLink(user, orgSlug, clubSlug, message);
  }
}
