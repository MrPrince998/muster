import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { Permission } from '../permission/permissions.js';
import { ClubAdminService } from './club-admin.service.js';
import {
  ClubMemberDto,
  ClubRoleDto,
  CreateRoleDto,
  MoveRoleDto,
  SetMemberRolesDto,
  TransferClubDto,
  UpdateRoleDto,
  ClubDetailsDto,
  UpdateClubDto,
} from './dto/club-admin.dto.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });
const below = error('Not below you in the hierarchy (MEMBER_ABOVE_YOU, ROLE_ABOVE_YOU)');

/** A club's members and what each may do. Seeing them needs only membership; changes need the permission named. */
@ApiTags('club members')
@Controller('clubs/:clubId')
export class ClubMemberController {
  constructor(private readonly admin: ClubAdminService) {}

  /** The club's name, description and who can join */
  @Get('settings')
  @RequirePermission()
  @ApiOkResponse({ type: ClubDetailsDto })
  details(@CurrentClubAccess() access: ClubAccess): Promise<ClubDetailsDto> {
    return this.admin.details(access);
  }

  /**
   * Change the club's name, description or who can join
   *
   * @remarks The owner, or anyone with role.manage. Who joins the default
   * club is the workspace's setting (DEFAULT_CLUB).
   */
  @Patch('settings')
  @RequirePermission()
  @ApiOkResponse({ type: ClubDetailsDto })
  updateDetails(@CurrentClubAccess() access: ClubAccess, @Body() dto: UpdateClubDto): Promise<ClubDetailsDto> {
    return this.admin.updateDetails(access, dto);
  }

  /** The club's members, senior first, each with their roles */
  @Get('members')
  @RequirePermission()
  @ApiOkResponse({ type: [ClubMemberDto] })
  members(@CurrentClubAccess() access: ClubAccess): Promise<ClubMemberDto[]> {
    return this.admin.members(access);
  }

  /**
   * Set someone's roles
   *
   * @remarks Needs role.manage. Replaces the roles they hold; every role
   * added or removed, and the person, must be below you.
   */
  @Put('members/:userId/roles')
  @RequirePermission(Permission.RoleManage)
  @ApiOkResponse({ type: ClubMemberDto })
  @ApiForbiddenResponse(below)
  @ApiNotFoundResponse(error('Not a member (MEMBER_NOT_FOUND), or no such role (ROLE_NOT_FOUND)'))
  setRoles(
    @CurrentClubAccess() access: ClubAccess,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() { roleIds }: SetMemberRolesDto,
  ): Promise<ClubMemberDto> {
    return this.admin.setMemberRoles(access, userId, roleIds);
  }

  /** Leave the club (not the workspace's default club; an owner hands it over first) */
  @Delete('members/me')
  @RequirePermission()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Left' })
  @ApiConflictResponse(error('The default club (DEFAULT_CLUB), or you own it (OWNS_CLUB)'))
  leave(@CurrentClubAccess() access: ClubAccess): Promise<void> {
    return this.admin.leave(access);
  }

  /** Remove someone from the club. Needs member.remove; they must be below you */
  @Delete('members/:userId')
  @RequirePermission(Permission.MemberRemove)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiForbiddenResponse(below)
  @ApiConflictResponse(error('The default club: remove them from the workspace (DEFAULT_CLUB)'))
  remove(@CurrentClubAccess() access: ClubAccess, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.admin.removeMember(access, userId);
  }

  /** Hand the club to another member. Owner only; you keep the most senior role below */
  @Post('transfer-ownership')
  @RequirePermission()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Transferred' })
  @ApiForbiddenResponse(error('Not the owner (NOT_OWNER)'))
  @ApiNotFoundResponse(error('Not a member (MEMBER_NOT_FOUND)'))
  transfer(@CurrentClubAccess() access: ClubAccess, @Body() { userId }: TransferClubDto): Promise<void> {
    return this.admin.transferOwnership(access, userId);
  }
}

/** A club's roles: Discord-style, ordered, built from the fixed permission list. */
@ApiTags('club roles')
@Controller('clubs/:clubId/roles')
export class ClubRoleController {
  constructor(private readonly admin: ClubAdminService) {}

  /** The club's roles, senior first (Owner not listed), each marked if you can manage it */
  @Get()
  @RequirePermission()
  @ApiOkResponse({ type: [ClubRoleDto] })
  roles(@CurrentClubAccess() access: ClubAccess): Promise<ClubRoleDto[]> {
    return this.admin.roles(access);
  }

  /**
   * Create a role
   *
   * @remarks Needs role.manage. It starts at the bottom; only permissions you
   * hold. Returns every role.
   */
  @Post()
  @RequirePermission(Permission.RoleManage)
  @ApiCreatedResponse({ type: [ClubRoleDto] })
  @ApiForbiddenResponse(error("A permission you don't hold (PERMISSION_NOT_YOURS)"))
  @ApiConflictResponse(error('Name taken (ROLE_NAME_TAKEN), or too many roles (TOO_MANY_ROLES)'))
  create(@CurrentClubAccess() access: ClubAccess, @Body() dto: CreateRoleDto): Promise<ClubRoleDto[]> {
    return this.admin.createRole(access, dto);
  }

  /** Rename a role or change its permissions. Needs role.manage; the role must be below yours */
  @Patch(':roleId')
  @RequirePermission(Permission.RoleManage)
  @ApiOkResponse({ type: [ClubRoleDto] })
  @ApiForbiddenResponse(error("Above you (ROLE_ABOVE_YOU), or a permission you don't hold (PERMISSION_NOT_YOURS)"))
  @ApiConflictResponse(error('Name taken (ROLE_NAME_TAKEN)'))
  update(
    @CurrentClubAccess() access: ClubAccess,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<ClubRoleDto[]> {
    return this.admin.updateRole(access, roleId, dto);
  }

  /** Move a role one place up or down. Needs role.manage; both roles swapped must be below yours */
  @Post(':roleId/move')
  @RequirePermission(Permission.RoleManage)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: [ClubRoleDto] })
  @ApiForbiddenResponse(below)
  @ApiConflictResponse(error('Already at the top or bottom (ROLE_AT_EDGE)'))
  @ApiBadRequestResponse(error('direction must be up or down'))
  move(
    @CurrentClubAccess() access: ClubAccess,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() { direction }: MoveRoleDto,
  ): Promise<ClubRoleDto[]> {
    return this.admin.moveRole(access, roleId, direction);
  }

  /** Delete a role. Needs role.manage; it must be below yours. Invite links giving it give no role after */
  @Delete(':roleId')
  @RequirePermission(Permission.RoleManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse(below)
  remove(@CurrentClubAccess() access: ClubAccess, @Param('roleId', ParseUUIDPipe) roleId: string): Promise<void> {
    return this.admin.deleteRole(access, roleId);
  }
}
