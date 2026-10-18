import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/errors/error-response.dto.js';
import { CurrentOrgMember } from '../decorators/current-org-member.decorator.js';
import { RequireOrgRole } from '../decorators/require-org-role.decorator.js';
import { OrgRole } from '../entities/org-member.entity.js';
import type { OrgMembership } from '../org-roles.js';
import { OrgMemberDto, TransferOwnershipDto, UpdateMemberRoleDto } from './dto/member.dto.js';
import { OrgMemberService } from './org-member.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('organisation members')
@Controller('orgs/:orgId')
export class OrgMemberController {
  constructor(private readonly members: OrgMemberService) {}

  /** Members of the workspace */
  @Get('members')
  @RequireOrgRole(OrgRole.Member)
  @ApiOkResponse({ type: [OrgMemberDto] })
  list(@CurrentOrgMember() me: OrgMembership): Promise<OrgMemberDto[]> {
    return this.members.list(me);
  }

  /**
   * Change someone's role
   *
   * @remarks Only for people ranked below you, and only to roles below
   * yours: the owner appoints admins, admins appoint moderators.
   */
  @Patch('members/:userId')
  @RequireOrgRole(OrgRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Role changed' })
  @ApiNotFoundResponse(error('Not a member (MEMBER_NOT_FOUND)'))
  changeRole(
    @CurrentOrgMember() me: OrgMembership,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() { role }: UpdateMemberRoleDto,
  ): Promise<void> {
    return this.members.changeRole(me, userId, role);
  }

  /**
   * Remove someone from the workspace
   *
   * @remarks Also removes them from every club in it. Only people ranked
   * below you: moderators remove members, admins also remove moderators.
   */
  @Delete('members/:userId')
  @RequireOrgRole(OrgRole.Moderator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse(error('Not a member (MEMBER_NOT_FOUND)'))
  @ApiConflictResponse(error('They own a club (OWNS_CLUB)'))
  remove(@CurrentOrgMember() me: OrgMembership, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.members.remove(me, userId);
  }

  /** Leave the workspace and all its clubs */
  @Post('leave')
  @RequireOrgRole(OrgRole.Member)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Left' })
  @ApiConflictResponse(error('The owner must transfer ownership first (OWNER_CANNOT_LEAVE), or you own a club (OWNS_CLUB)'))
  leave(@CurrentOrgMember() me: OrgMembership): Promise<void> {
    return this.members.leave(me);
  }

  /**
   * Hand the workspace to another member (owner only)
   *
   * @remarks You become an admin. Ownership of the default club moves too.
   */
  @Post('transfer-ownership')
  @RequireOrgRole(OrgRole.Owner)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Ownership transferred' })
  @ApiNotFoundResponse(error('Not a member (MEMBER_NOT_FOUND)'))
  @ApiBadRequestResponse(error('You already own it (ALREADY_OWNER)'))
  transferOwnership(@CurrentOrgMember() me: OrgMembership, @Body() { userId }: TransferOwnershipDto): Promise<void> {
    return this.members.transferOwnership(me, userId);
  }
}
