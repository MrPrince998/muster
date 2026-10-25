import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { CurrentOrgMember } from '../organisation/decorators/current-org-member.decorator.js';
import { RequireOrgRole } from '../organisation/decorators/require-org-role.decorator.js';
import { OrgRole } from '../organisation/entities/org-member.entity.js';
import type { OrgMembership } from '../organisation/org-roles.js';
import { ClubDirectoryEntryDto, JoinClubDto, JoinClubResultDto } from './dto/invite.dto.js';
import { InviteService } from './invite.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

/** The workspace's clubs, for its members to find and join (each club decides who may). */
@ApiTags('club directory')
@Controller('orgs/:orgId/club-directory')
export class ClubDirectoryController {
  constructor(private readonly invites: InviteService) {}

  /** The clubs you could join, and the ones you're in */
  @Get()
  @RequireOrgRole(OrgRole.Member)
  @ApiOkResponse({ type: [ClubDirectoryEntryDto] })
  list(@CurrentOrgMember() me: OrgMembership): Promise<ClubDirectoryEntryDto[]> {
    return this.invites.directory(me);
  }

  /**
   * Join a club, or ask to
   *
   * @remarks An open club lets you straight in; one that asks gets a request
   * for its approvers. Invite-only clubs take an invite link (CLUB_INVITE_ONLY).
   */
  @Post(':clubId/join')
  @RequireOrgRole(OrgRole.Member)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: JoinClubResultDto })
  @ApiForbiddenResponse(error('Invite links only (CLUB_INVITE_ONLY)'))
  @ApiConflictResponse(error('In it already (ALREADY_IN_CLUB)'))
  join(
    @CurrentOrgMember() me: OrgMembership,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() { message }: JoinClubDto,
  ): Promise<JoinClubResultDto> {
    return this.invites.joinFromDirectory(me, clubId, message);
  }

  /** Take back your request to join */
  @Delete(':clubId/join-request')
  @RequireOrgRole(OrgRole.Member)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Request taken back' })
  cancel(@CurrentOrgMember() me: OrgMembership, @Param('clubId', ParseUUIDPipe) clubId: string): Promise<void> {
    return this.invites.cancelDirectoryRequest(me, clubId);
  }
}
