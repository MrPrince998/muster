import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { config } from '../../config/config.js';
import { BEARER_AUTH } from '../../swagger.js';
import { User } from '../user/entities/user.entity.js';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, SESSION_TTL_DAYS } from './auth.constants.js';
import { AuthService, type SignedIn } from './auth.service.js';
import {
  AuthTokensDto,
  ChangePasswordDto,
  EmailDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SessionDto,
  SignInDto,
  SignUpDto,
  TokenDto,
  UpdateProfileDto,
} from './dto/auth.dto.js';

/**
 * The refresh token lives only in this cookie: httpOnly so page scripts
 * (and any injected script) cannot read it, Secure in production, SameSite
 * Strict so other sites cannot make the browser send it, and scoped to /auth
 * so it travels with auth requests only.
 */
const refreshCookie: CookieOptions = {
  httpOnly: true,
  secure: config.env === 'production',
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
};

// stricter limit for routes that guess passwords or send email
const SENSITIVE = { default: { limit: 5, ttl: 60_000 } };

const error = (description: string) => ({ description, type: ErrorResponseDto });

@ApiTags('auth')
@ApiTooManyRequestsResponse(error('Too many attempts, try again in a minute'))
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Create an account
   *
   * @remarks Sends a verification email; sign-in works once it is confirmed.
   * Signing up with the email of a guest account (someone who registered for
   * an event without an account) turns that guest into a full account and
   * keeps their tickets.
   */
  @Public()
  @Throttle(SENSITIVE)
  @Post('signup')
  @ApiConflictResponse(error('Email already registered (EMAIL_TAKEN)'))
  signup(@Body() dto: SignUpDto): Promise<User> {
    return this.auth.signup(dto);
  }

  /**
   * Sign in
   *
   * @remarks Returns an access token and sets the refresh token as an
   * httpOnly cookie.
   */
  @Public()
  @Throttle(SENSITIVE)
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse(error('Wrong email or password (INVALID_CREDENTIALS)'))
  @ApiForbiddenResponse(error('Email not verified yet (EMAIL_NOT_VERIFIED)'))
  async signin(
    @Body() dto: SignInDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensDto> {
    const signedIn = await this.auth.signin(dto, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    return this.respondSignedIn(res, signedIn);
  }

  /**
   * Get a new access token
   *
   * @remarks Uses the refresh token cookie, and replaces it: each refresh
   * token works once. Reusing an old one signs that device out.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse(error('Missing, expired or reused refresh token (INVALID_REFRESH_TOKEN)'))
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthTokensDto> {
    try {
      return this.respondSignedIn(res, await this.auth.refresh(this.refreshTokenFrom(req)));
    } catch (e) {
      // a dead refresh token is useless; stop the browser sending it
      res.clearCookie(REFRESH_COOKIE, refreshCookie);
      throw e;
    }
  }

  /** Sign out of this device */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiNoContentResponse({ description: 'Signed out (also when already signed out)' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.refreshTokenFrom(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookie);
  }

  /** Sign out of every device, including this one */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(BEARER_AUTH)
  @ApiNoContentResponse({ description: 'Every session ended' })
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll(user);
    res.clearCookie(REFRESH_COOKIE, refreshCookie);
  }

  /** The signed-in user */
  @Get('me')
  @ApiBearerAuth(BEARER_AUTH)
  @ApiUnauthorizedResponse(error('Not signed in'))
  me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.me(user);
  }

  /**
   * Update your profile
   *
   * @remarks Only ever the signed-in person's own account. Just the name for
   * now: changing the email would need it confirmed again.
   */
  @Patch('me')
  @ApiBearerAuth(BEARER_AUTH)
  @ApiOkResponse({ type: User })
  @ApiUnauthorizedResponse(error('Not signed in'))
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<User> {
    return this.auth.updateProfile(user, dto);
  }

  /** Devices currently signed in */
  @Get('sessions')
  @ApiBearerAuth(BEARER_AUTH)
  @ApiOkResponse({ type: [SessionDto] })
  sessions(@CurrentUser() user: AuthUser): Promise<SessionDto[]> {
    return this.auth.listSessions(user);
  }

  /** Sign out one device */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(BEARER_AUTH)
  @ApiNoContentResponse({ description: 'Session ended' })
  @ApiNotFoundResponse(error('No such active session of yours (SESSION_NOT_FOUND)'))
  revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.auth.revokeSession(user, id);
  }

  /** Confirm an email address with the emailed token */
  @Public()
  @Throttle(SENSITIVE)
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Email verified; the user can now sign in' })
  verifyEmail(@Body() { token }: TokenDto): Promise<void> {
    return this.auth.verifyEmail(token);
  }

  /**
   * Send a new verification email
   *
   * @remarks Always answers 202, whether or not the email has an account.
   */
  @Public()
  @Throttle(SENSITIVE)
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'If the account exists and is unverified, an email is on its way' })
  resendVerification(@Body() { email, next }: ResendVerificationDto): Promise<void> {
    return this.auth.resendVerification(email, next);
  }

  /**
   * Email a password reset link
   *
   * @remarks Always answers 202, whether or not the email has an account.
   */
  @Public()
  @Throttle(SENSITIVE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'If the account exists, an email is on its way' })
  forgotPassword(@Body() { email }: EmailDto): Promise<void> {
    return this.auth.forgotPassword(email);
  }

  /**
   * Set a new password with the emailed token
   *
   * @remarks Signs out every device.
   */
  @Public()
  @Throttle(SENSITIVE)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Password changed; sign in again' })
  resetPassword(@Body() { token, password }: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(token, password);
  }

  /**
   * Change password
   *
   * @remarks Signs out every other device; this one stays signed in.
   */
  @Throttle(SENSITIVE)
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(BEARER_AUTH)
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiForbiddenResponse(error('Current password is wrong (INVALID_PASSWORD)'))
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() { currentPassword, newPassword }: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(user, currentPassword, newPassword);
  }

  private respondSignedIn(res: Response, { refreshToken, ...tokens }: SignedIn): AuthTokensDto {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...refreshCookie,
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    return tokens;
  }

  private refreshTokenFrom(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
