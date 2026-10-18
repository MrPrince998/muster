import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { EmailService } from '../email/email.service.js';
import { User } from '../user/entities/user.entity.js';
import { UserService } from '../user/user.service.js';
import { AccessTokenService } from './access-token.service.js';
import { RESET_PASSWORD_TTL_MINUTES, VERIFY_EMAIL_TTL_MINUTES } from './auth.constants.js';
import type { AuthTokensDto, SessionDto, SignInDto, SignUpDto } from './dto/auth.dto.js';
import { EmailTokenService } from './email-token.service.js';
import { EmailTokenPurpose } from './entities/email-token.entity.js';
import { SessionService, type SessionMeta } from './session.service.js';

const emailTaken = () => HttpError.conflict('Email already registered', 'EMAIL_TAKEN');
// one error for unknown email, guest account and wrong password alike
const invalidCredentials = () => HttpError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
const invalidLink = () =>
  HttpError.badRequest('This link is invalid or has expired. Request a new one.', 'INVALID_TOKEN');
const invalidRefreshToken = () =>
  HttpError.unauthorized('Session expired. Sign in again.', 'INVALID_REFRESH_TOKEN');

/** Access token response plus the refresh token, which the controller puts in a cookie. */
export type SignedIn = AuthTokensDto & { refreshToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
    private readonly emailTokens: EmailTokenService,
    private readonly email: EmailService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // --- sign-up and sign-in ----------------------------------------------------

  async signup({ email, name, password, next }: SignUpDto): Promise<User> {
    // checked before hashing, so a taken email does not cost a scrypt run
    const existing = await this.users.findAccountStatus(email);
    if (existing?.hasPassword) throw emailTaken();

    const passwordHash = await this.passwordHasher.hash(password);

    let user: User;
    if (existing) {
      // A guest (registered for an event, never signed up) claims their row,
      // keeping their tickets. Sign-in stays blocked until the email is
      // verified, so knowing a guest's address is not enough to take over
      // their account.
      const claimed = await this.users.claimGuestAccount(existing.id, { name, passwordHash });
      // null: someone else set a password between our check and this update
      if (!claimed) throw emailTaken();
      user = claimed;
    } else {
      try {
        user = await this.users.createAccount({ email, name, passwordHash });
      } catch (error) {
        // two sign-ups with the same email at once: both passed the check
        // above, the unique index stopped the second
        if (isUniqueViolation(error, 'users_email_key')) throw emailTaken();
        throw error;
      }
    }

    await this.sendVerification(user, next);
    return user;
  }

  async signin({ email, password }: SignInDto, meta: SessionMeta): Promise<SignedIn> {
    const candidate = await this.users.findSignInCandidate(email);
    // Always one scrypt run: for an unknown email or a guest (no hash),
    // verify() checks a dummy hash, so timing does not reveal which
    // addresses have accounts.
    const valid = await this.passwordHasher.verify(password, candidate?.passwordHash);
    if (!candidate?.passwordHash || !valid) throw invalidCredentials();

    // checked only after the password, so it reveals nothing to a stranger
    if (!candidate.emailVerifiedAt) {
      throw HttpError.forbidden('Verify your email address before signing in', 'EMAIL_NOT_VERIFIED');
    }

    // the only moment we hold the plain password: upgrade an outdated hash
    if (this.passwordHasher.needsRehash(candidate.passwordHash)) {
      await this.users.setPasswordHash(candidate.id, await this.passwordHasher.hash(password));
    }
    await this.users.recordSignIn(candidate.id);

    const { sessionId, refreshToken } = await this.sessions.create(candidate.id, meta);
    return this.signedIn(candidate.id, sessionId, refreshToken);
  }

  // --- sessions ---------------------------------------------------------------

  async refresh(refreshToken: string | undefined): Promise<SignedIn> {
    if (!refreshToken) throw invalidRefreshToken();
    const rotated = await this.sessions.rotate(refreshToken);
    if (!rotated) throw invalidRefreshToken();
    return this.signedIn(rotated.userId, rotated.sessionId, rotated.refreshToken);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.sessions.revokeByRefreshToken(refreshToken);
  }

  async logoutAll(user: AuthUser): Promise<void> {
    await this.sessions.revokeAll(user.id);
  }

  async listSessions(user: AuthUser): Promise<SessionDto[]> {
    const sessions = await this.sessions.listActive(user.id);
    return sessions.map((s) => ({ ...s, current: s.id === user.sessionId }));
  }

  async revokeSession(user: AuthUser, sessionId: string): Promise<void> {
    if (!(await this.sessions.revoke(sessionId, user.id))) {
      throw HttpError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
  }

  me(user: AuthUser): Promise<User> {
    return this.users.findOne(user.id);
  }

  /** Changes your own name; the id comes from your access token, never the request. */
  updateProfile(user: AuthUser, { name }: { name: string }): Promise<User> {
    return this.users.update(user.id, { name: name.trim() });
  }

  // --- email verification -----------------------------------------------------

  async verifyEmail(token: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const used = await this.emailTokens.consume(token, EmailTokenPurpose.VerifyEmail, m);
      if (!used) throw invalidLink();
      // false if the account's email changed since the link was sent; the
      // thrown error rolls the token back so nothing is half-done
      if (!(await this.users.markEmailVerified(used.userId, used.email, m))) throw invalidLink();
    });
  }

  /** Always succeeds from the caller's view: whether the email exists is not revealed. */
  async resendVerification(email: string, next?: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (user && !user.emailVerifiedAt) await this.sendVerification(user, next);
  }

  // --- passwords --------------------------------------------------------------

  /** Always succeeds from the caller's view: whether the email exists is not revealed. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;

    // guests get one too: proving they own the inbox is exactly what lets
    // them set a password safely
    const { token, id } = await this.emailTokens.issue(
      user.id,
      EmailTokenPurpose.ResetPassword,
      user.email,
      RESET_PASSWORD_TTL_MINUTES,
    );
    this.email.inBackground(
      'password reset',
      this.email.sendPasswordReset({
        to: user.email,
        name: user.name,
        token,
        expiresInMinutes: RESET_PASSWORD_TTL_MINUTES,
        idempotencyKey: id,
      }),
    );
  }

  /**
   * Sets a new password from an emailed link, then signs out every device.
   * One transaction: either all of it happens or none.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    // hashed outside the transaction so it does not hold a connection for
    // the duration of a scrypt run
    const passwordHash = await this.passwordHasher.hash(password);

    await this.dataSource.transaction(async (m) => {
      const used = await this.emailTokens.consume(token, EmailTokenPurpose.ResetPassword, m);
      if (!used) throw invalidLink();
      // the link proves they own the inbox, so this also verifies the email;
      // false if the address changed since the link was sent
      if (!(await this.users.markEmailVerified(used.userId, used.email, m))) throw invalidLink();

      await this.users.setPasswordHash(used.userId, passwordHash, m);
      await this.emailTokens.invalidateAll(used.userId, EmailTokenPurpose.ResetPassword, m);
      await this.sessions.revokeAll(used.userId, undefined, m);
    });
  }

  /** Changes the password and signs out every other device, keeping this one. */
  async changePassword(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const currentHash = await this.users.findPasswordHash(user.id);
    if (!(await this.passwordHasher.verify(currentPassword, currentHash))) {
      throw HttpError.forbidden('Current password is incorrect', 'INVALID_PASSWORD');
    }

    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.dataSource.transaction(async (m) => {
      await this.users.setPasswordHash(user.id, passwordHash, m);
      await this.emailTokens.invalidateAll(user.id, EmailTokenPurpose.ResetPassword, m);
      await this.sessions.revokeAll(user.id, user.sessionId, m);
    });
  }

  // --- helpers ----------------------------------------------------------------

  private async signedIn(userId: string, sessionId: string, refreshToken: string): Promise<SignedIn> {
    const [{ accessToken, expiresIn }, user] = await Promise.all([
      this.accessTokens.issue(userId, sessionId),
      this.users.findOne(userId),
    ]);
    return { accessToken, tokenType: 'Bearer', expiresIn, user, refreshToken };
  }

  // `next`: a page to return to after confirming (an invite link), carried in
  // the email's link so it survives a different device or browser
  private async sendVerification(user: Pick<User, 'id' | 'email' | 'name'>, next?: string): Promise<void> {
    const { token, id } = await this.emailTokens.issue(
      user.id,
      EmailTokenPurpose.VerifyEmail,
      user.email,
      VERIFY_EMAIL_TTL_MINUTES,
    );
    this.email.inBackground(
      'verification',
      this.email.sendVerifyEmail({
        to: user.email,
        name: user.name,
        token,
        expiresInMinutes: VERIFY_EMAIL_TTL_MINUTES,
        idempotencyKey: id,
        ...(next && { next }),
      }),
    );
  }
}
