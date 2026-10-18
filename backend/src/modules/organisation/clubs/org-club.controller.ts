import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/errors/error-response.dto.js';
import { CurrentOrgMember } from '../decorators/current-org-member.decorator.js';
import { RequireOrgRole } from '../decorators/require-org-role.decorator.js';
import { OrgRole } from '../entities/org-member.entity.js';
import type { OrgMembership } from '../org-roles.js';
import { ClubSummaryDto, CreateClubDto } from './dto/org-club.dto.js';
import { OrgClubService } from './org-club.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

// Lives in the organisation module (not ClubModule) because it guards with
// @RequireOrgRole(), and OrganisationModule already imports ClubModule.
@ApiTags('clubs')
@Controller('orgs/:orgId/clubs')
export class OrgClubController {
  constructor(private readonly clubs: OrgClubService) {}

  /**
   * Your clubs in this workspace
   *
   * @remarks Each with its member count, upcoming events, and your
   * permissions there, so the app can show only what you can do.
   */
  @Get()
  @RequireOrgRole(OrgRole.Member)
  @ApiOkResponse({ type: [ClubSummaryDto] })
  list(@CurrentOrgMember() me: OrgMembership): Promise<ClubSummaryDto[]> {
    return this.clubs.list(me);
  }

  /**
   * Create a club
   *
   * @remarks It starts with the default roles, and you hold Owner.
   */
  @Post()
  @RequireOrgRole(OrgRole.Admin)
  @ApiCreatedResponse({ type: ClubSummaryDto })
  @ApiConflictResponse(error('No free URL for that name (SLUG_TAKEN)'))
  create(@CurrentOrgMember() me: OrgMembership, @Body() dto: CreateClubDto): Promise<ClubSummaryDto> {
    return this.clubs.create(me, dto);
  }
}
