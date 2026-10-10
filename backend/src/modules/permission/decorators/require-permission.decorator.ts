import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { PermissionGuard, REQUIRED_PERMISSIONS_KEY } from '../guards/permission.guard.js';
import type { Permission } from '../permissions.js';

/**
 * Requires the current user to be a member of the route's club (:clubId) and
 * to hold every listed permission. With no arguments it only requires
 * membership.
 *
 *   @RequirePermission(Permission.EventCreate)
 *   @Post('clubs/:clubId/events')
 *   create(@CurrentClubAccess() access: ClubAccess) { ... }
 */
export function RequirePermission(...permissions: Permission[]) {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions),
    UseGuards(PermissionGuard),
  );
}
