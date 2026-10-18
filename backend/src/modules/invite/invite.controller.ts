import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { Permission } from '../permission/permissions.js';
import {
  AcceptInviteResultDto,
  ClubJoinRequestDto,
  ClubRoleDto,
  CreateInviteDto,
  InviteDto,
  InvitePreviewDto,
} from './dto/invite.dto.js';
import { InviteService } from './invite.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

/** A club's invite links, for people with invite.manage. */
@ApiTags('invites')
@Controller('clubs/:clubId')
export class ClubInviteController {
  constructor(private readonly invites: InviteService) {}

  /** The club's links that haven't been turned off */
  @Get('invites')
  @RequirePermission(Permission.InviteManage)
  @ApiOkResponse({ type: [InviteDto] })
  list(@CurrentClubAccess() access: ClubAccess): Promise<InviteDto[]> {
    return this.invites.list(access);
  }

  /**
   * Create an invite link
   *
   * @remarks Joining through it adds people to the workspace (if they aren't
   * in it), its General club, and this club, with the role it gives.
   */
  @Post('invites')
  @RequirePermission(Permission.InviteManage)
  @ApiCreatedResponse({ type: InviteDto })
  @ApiBadRequestResponse(error('The role is not in this club (ROLE_NOT_FOUND)'))
  @ApiForbiddenResponse(error('The role is not below yours (ROLE_TOO_HIGH)'))
  create(@CurrentClubAccess() access: ClubAccess, @Body() dto: CreateInviteDto): Promise<InviteDto> {
    return this.invites.create(access, dto);
  }

  /** Turn a link off */
  @Delete('invites/:inviteId')
  @RequirePermission(Permission.InviteManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Turned off' })
  @ApiNotFoundResponse(error('No such link, or already off (INVITE_NOT_FOUND)'))
  revoke(@CurrentClubAccess() access: ClubAccess, @Param('inviteId', ParseUUIDPipe) inviteId: string): Promise<void> {
    return this.invites.revoke(access, inviteId);
  }

  /** People waiting to join through links that need approval */
  @Get('join-requests')
  @RequirePermission(Permission.MemberApprove)
  @ApiOkResponse({ type: [ClubJoinRequestDto] })
  pendingRequests(@CurrentClubAccess() access: ClubAccess): Promise<ClubJoinRequestDto[]> {
    return this.invites.pendingRequests(access);
  }

  /** Let them in, with the role of the link they used */
  @Post('join-requests/:requestId/approve')
  @RequirePermission(Permission.MemberApprove)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Approved' })
  @ApiNotFoundResponse(error('No pending request with that id (JOIN_REQUEST_NOT_FOUND)'))
  approve(@CurrentClubAccess() access: ClubAccess, @Param('requestId', ParseUUIDPipe) requestId: string): Promise<void> {
    return this.invites.approve(access, requestId);
  }

  /** Decline a request */
  @Post('join-requests/:requestId/reject')
  @RequirePermission(Permission.MemberApprove)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Declined' })
  @ApiNotFoundResponse(error('No pending request with that id (JOIN_REQUEST_NOT_FOUND)'))
  reject(@CurrentClubAccess() access: ClubAccess, @Param('requestId', ParseUUIDPipe) requestId: string): Promise<void> {
    return this.invites.reject(access, requestId);
  }

  /** The club's roles (Owner excluded), each marked if you can give it */
  @Get('roles')
  @RequirePermission()
  @ApiOkResponse({ type: [ClubRoleDto] })
  roles(@CurrentClubAccess() access: ClubAccess): Promise<ClubRoleDto[]> {
    return this.invites.roles(access);
  }
}

/**
 * Using a link: anyone signed in who has it. Rate limited per client, so
 * nobody can try codes at speed (they're 128-bit, but cheap to be sure).
 */
@ApiTags('invites')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@ApiTooManyRequestsResponse(error('Too many attempts; try again in a minute'))
@Controller('invites/:code')
export class InviteLinkController {
  constructor(private readonly invites: InviteService) {}

  /** Where a link leads, and whether it still works */
  @Get()
  @ApiOkResponse({ type: InvitePreviewDto })
  @ApiNotFoundResponse(error('No such link (INVITE_NOT_FOUND)'))
  preview(@CurrentUser() user: AuthUser, @Param('code') code: string): Promise<InvitePreviewDto> {
    return this.invites.preview(user, code);
  }

  /** Join through a link */
  @Post('accept')
  @ApiCreatedResponse({ type: AcceptInviteResultDto })
  @ApiNotFoundResponse(error('No such link (INVITE_NOT_FOUND)'))
  @ApiGoneResponse(error('Turned off (INVITE_REVOKED), expired (INVITE_EXPIRED) or used up (INVITE_USED_UP)'))
  accept(@CurrentUser() user: AuthUser, @Param('code') code: string): Promise<AcceptInviteResultDto> {
    return this.invites.accept(user, code);
  }
}
