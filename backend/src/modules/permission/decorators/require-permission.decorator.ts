import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtension,
  ApiForbiddenResponse,
  ApiParam,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/errors/error-response.dto.js';
import { BEARER_AUTH } from '../../../swagger.js';
import { CLUB_ID_PARAM, PermissionGuard, REQUIRED_PERMISSIONS_KEY } from '../guards/permission.guard.js';
import type { Permission } from '../permissions.js';

/**
 * Requires the current user to be a member of the route's club (:clubId) and
 * to hold every listed permission. With no arguments it only requires
 * membership.
 *
 *   @RequirePermission(Permission.EventCreate)
 *   @Post('clubs/:clubId/events')
 *   create(@CurrentClubAccess() access: ClubAccess) { ... }
 *
 * Also documents all of that in Swagger, so the docs cannot drift from what
 * the guard enforces.
 */
export function RequirePermission(...permissions: Permission[]) {
  const needs = permissions.length > 0 ? permissions.join(', ') : 'club membership only';
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions),
    UseGuards(PermissionGuard),
    ApiBearerAuth(BEARER_AUTH),
    ApiParam({ name: CLUB_ID_PARAM, format: 'uuid' }),
    ApiExtension('x-required-permissions', permissions),
    ApiUnauthorizedResponse({ description: 'Not signed in', type: ErrorResponseDto }),
    ApiForbiddenResponse({
      description: `Not a club member (NOT_CLUB_MEMBER) or missing a permission (MISSING_PERMISSION). Requires: ${needs}`,
      type: ErrorResponseDto,
    }),
  );
}
