import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/errors/error-response.dto.js';
import { CurrentOrgMember } from '../decorators/current-org-member.decorator.js';
import { RequireOrgRole } from '../decorators/require-org-role.decorator.js';
import { OrgRole } from '../entities/org-member.entity.js';
import type { OrgMembership } from '../org-roles.js';
import { JoinRequestsPageDto, ListJoinRequestsQuery } from './dto/join-request.dto.js';
import { OrgJoinRequestService } from './org-join-request.service.js';

const alreadyDecided = {
  description: 'No pending request with that id; it may already be decided (JOIN_REQUEST_NOT_FOUND)',
  type: ErrorResponseDto,
};

/** The moderators' queue for workspaces whose join policy is "request". */
@ApiTags('organisation join requests')
@Controller('orgs/:orgId/join-requests')
export class OrgJoinRequestController {
  constructor(private readonly joinRequests: OrgJoinRequestService) {}

  /** Requests to join (moderators and above) */
  @Get()
  @RequireOrgRole(OrgRole.Moderator)
  @ApiOkResponse({ type: JoinRequestsPageDto })
  list(@CurrentOrgMember() me: OrgMembership, @Query() query: ListJoinRequestsQuery): Promise<JoinRequestsPageDto> {
    return this.joinRequests.list(me, query);
  }

  /** Let them in: they join the workspace and its default club */
  @Post(':requestId/approve')
  @RequireOrgRole(OrgRole.Moderator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Approved' })
  @ApiNotFoundResponse(alreadyDecided)
  approve(@CurrentOrgMember() me: OrgMembership, @Param('requestId', ParseUUIDPipe) requestId: string): Promise<void> {
    return this.joinRequests.approve(me, requestId);
  }

  /** Decline. They can ask again after a cooldown. */
  @Post(':requestId/reject')
  @RequireOrgRole(OrgRole.Moderator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Rejected' })
  @ApiNotFoundResponse(alreadyDecided)
  reject(@CurrentOrgMember() me: OrgMembership, @Param('requestId', ParseUUIDPipe) requestId: string): Promise<void> {
    return this.joinRequests.reject(me, requestId);
  }
}
