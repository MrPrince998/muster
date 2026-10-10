import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ClubAccess } from '../club-access.js';
import '../guards/permission.guard.js';

/**
 * The ClubAccess resolved by @RequirePermission() for this request. Only
 * available on routes that use @RequirePermission().
 */
export const CurrentClubAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClubAccess => {
    const access = context.switchToHttp().getRequest<Request>().clubAccess;
    if (!access) {
      throw new Error('@CurrentClubAccess() used on a route without @RequirePermission()');
    }
    return access;
  },
);
