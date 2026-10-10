import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { HttpError } from '../../../common/errors/http-error.js';
import '../../../common/types/auth-user.js';
import { ClubAccess } from '../club-access.js';
import { PermissionService } from '../permission.service.js';
import type { Permission } from '../permissions.js';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

// routes protected by @RequirePermission() must identify the club this way:
// /clubs/:clubId/events
export const CLUB_ID_PARAM = 'clubId';

declare global {
  namespace Express {
    interface Request {
      // set by PermissionGuard; read it with @CurrentClubAccess()
      clubAccess?: ClubAccess;
    }
  }
}

/**
 * Checks that the current user is a member of the route's club and holds every
 * required permission. Attach it with @RequirePermission(), which also sets the
 * metadata this guard reads.
 *
 * Runs after the (global) auth guard, which sets request.user.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const request = context.switchToHttp().getRequest<Request>();

    if (!request.user) {
      throw HttpError.unauthorized();
    }

    const clubId = request.params[CLUB_ID_PARAM];
    if (typeof clubId !== 'string') {
      // a programming error (route has no :clubId), not a client error
      throw new Error(`@RequirePermission() used on a route without :${CLUB_ID_PARAM}`);
    }
    if (!isUUID(clubId)) {
      throw HttpError.badRequest('Invalid club id', 'INVALID_CLUB_ID');
    }

    const access = await this.permissionService.getClubAccess(clubId, request.user.id);
    if (!access) {
      throw HttpError.forbidden('You are not a member of this club', 'NOT_CLUB_MEMBER');
    }

    const missing = access.missing(required);
    if (missing.length > 0) {
      throw HttpError.forbidden('Missing permission', 'MISSING_PERMISSION', { missing });
    }

    // handlers and services reuse it for hierarchy checks without a second query
    request.clubAccess = access;
    return true;
  }
}
