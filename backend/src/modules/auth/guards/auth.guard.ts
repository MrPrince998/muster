import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { HttpError } from '../../../common/errors/http-error.js';
import '../../../common/types/auth-user.js';
import { AccessTokenService } from '../access-token.service.js';
import { SessionService } from '../session.service.js';

/**
 * Global guard: every route needs a valid access token unless marked
 * @Public(). Runs before route-level guards such as @RequirePermission(),
 * which rely on the request.user it sets.
 *
 * Besides the signature, it checks the token's session is still active. That
 * costs one primary-key lookup per request, and buys immediate sign-out:
 * "log out of all devices" and password resets take effect on the next
 * request, not when the access token happens to expire.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw HttpError.unauthorized('Sign in required', 'UNAUTHENTICATED');
    }

    const claims = await this.accessTokens.verify(token);
    if (!claims) {
      throw HttpError.unauthorized('Invalid or expired access token', 'INVALID_TOKEN');
    }

    if (!(await this.sessions.isActive(claims.sessionId, claims.userId))) {
      throw HttpError.unauthorized('Session has ended', 'SESSION_ENDED');
    }

    request.user = { id: claims.userId, sessionId: claims.sessionId };
    return true;
  }
}
