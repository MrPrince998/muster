import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../types/auth-user.js';

/** The signed-in user ({ id, sessionId }) set by the auth guard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<Request>().user;
  if (!user) {
    throw new Error('@CurrentUser() used on a @Public() route');
  }
  return user;
});
