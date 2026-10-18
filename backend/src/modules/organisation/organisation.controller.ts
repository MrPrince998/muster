import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { BEARER_AUTH } from '../../swagger.js';
import { CurrentOrgMember } from './decorators/current-org-member.decorator.js';
import { RequireOrgRole } from './decorators/require-org-role.decorator.js';
import {
  CreateOrganisationDto,
  DeleteOrganisationDto,
  MyOrganisationDto,
  OrganisationDto,
  UpdateOrganisationDto,
} from './dto/organisation.dto.js';
import { OrgRole } from './entities/org-member.entity.js';
import {
  JoinOrganisationDto,
  JoinResultDto,
  OrganisationPreviewDto,
} from './join-requests/dto/join-request.dto.js';
import { OrganisationService } from './organisation.service.js';
import type { OrgMembership } from './org-roles.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('organisations')
@ApiBearerAuth(BEARER_AUTH)
@Controller('orgs')
export class OrganisationController {
  constructor(private readonly organisations: OrganisationService) {}

  /**
   * Create a workspace
   *
   * @remarks You become its owner. It starts with a default club, "General",
   * which you own.
   */
  @Post()
  @ApiConflictResponse(error('The chosen slug is taken (SLUG_TAKEN)'))
  @ApiBadRequestResponse(error('Invalid input, or a reserved slug (SLUG_RESERVED)'))
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganisationDto): Promise<OrganisationDto> {
    return this.organisations.create(user, dto);
  }

  /** Workspaces you belong to */
  @Get()
  @ApiOkResponse({ type: [MyOrganisationDto] })
  listMine(@CurrentUser() user: AuthUser): Promise<MyOrganisationDto[]> {
    return this.organisations.listMine(user);
  }

  /** Look up a workspace by its URL name */
  @Get('by-slug/:slug')
  @ApiNotFoundResponse(error('No such workspace, or not a member (ORG_NOT_FOUND)'))
  findBySlug(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<OrganisationDto> {
    return this.organisations.findBySlug(user, slug);
  }

  /**
   * Preview a workspace before joining
   *
   * @remarks For "apply to join" screens. Invite-only workspaces are hidden
   * from non-members (404).
   */
  @Get('by-slug/:slug/preview')
  @ApiOkResponse({ type: OrganisationPreviewDto })
  @ApiNotFoundResponse(error('No such workspace, or invite-only (ORG_NOT_FOUND)'))
  preview(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<OrganisationPreviewDto> {
    return this.organisations.preview(user, slug);
  }

  /**
   * Join, or ask to join
   *
   * @remarks Depends on the workspace's join policy. **open**: you join at
   * once. **request**: a moderator reviews your request (`status:
   * "requested"`). **invite**: only invite links work, so this answers 404.
   */
  @Post('by-slug/:slug/join')
  @ApiCreatedResponse({ type: JoinResultDto })
  @ApiNotFoundResponse(error('No such workspace, or invite-only (ORG_NOT_FOUND)'))
  @ApiConflictResponse(
    error('Already a member (ALREADY_MEMBER), a request is pending (REQUEST_PENDING), or the last one was declined recently (REQUEST_RECENTLY_REJECTED)'),
  )
  join(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Body() { message }: JoinOrganisationDto,
  ): Promise<JoinResultDto> {
    return this.organisations.join(user, slug, message);
  }

  /** Withdraw your pending request to join */
  @Delete('by-slug/:slug/join')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Request withdrawn' })
  @ApiNotFoundResponse(error('No pending request (JOIN_REQUEST_NOT_FOUND)'))
  cancelJoinRequest(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<void> {
    return this.organisations.cancelJoinRequest(user, slug);
  }

  /** A workspace you belong to */
  @Get(':orgId')
  @RequireOrgRole(OrgRole.Member)
  findOne(@CurrentOrgMember() me: OrgMembership): Promise<OrganisationDto> {
    return this.organisations.findOne(me);
  }

  /** Update name, slug or join policy (admins and the owner) */
  @Patch(':orgId')
  @RequireOrgRole(OrgRole.Admin)
  @ApiConflictResponse(error('The slug is taken (SLUG_TAKEN)'))
  update(@CurrentOrgMember() me: OrgMembership, @Body() dto: UpdateOrganisationDto): Promise<OrganisationDto> {
    return this.organisations.update(me, dto);
  }

  /**
   * Delete the workspace (owner only)
   *
   * @remarks Permanently deletes every club, event and registration in it.
   */
  @Delete(':orgId')
  @RequireOrgRole(OrgRole.Owner)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse(error('confirmSlug does not match (CONFIRMATION_MISMATCH)'))
  remove(@CurrentOrgMember() me: OrgMembership, @Body() { confirmSlug }: DeleteOrganisationDto): Promise<void> {
    return this.organisations.remove(me, confirmSlug);
  }
}
