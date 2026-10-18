import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';

interface AccessTokenClaims {
  // user id
  sub: string;
  // session id: lets the guard reject tokens of signed-out sessions
  sid: string;
  iat: number;
  exp: number;
}

/**
 * Short-lived access tokens (JWT, HS256). They carry ids only: permissions
 * and profile data are always read fresh, so a token can never grant what
 * the user has since lost.
 */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(userId: string, sessionId: string): Promise<{ accessToken: string; expiresIn: number }> {
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: sessionId });
    const { iat, exp } = this.jwt.decode<AccessTokenClaims>(accessToken);
    return { accessToken, expiresIn: exp - iat };
  }

  /** The token's ids, or null if it is malformed, forged or expired. */
  async verify(token: string): Promise<{ userId: string; sessionId: string } | null> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      if (!isUUID(claims.sub) || !isUUID(claims.sid)) return null;
      return { userId: claims.sub, sessionId: claims.sid };
    } catch {
      return null;
    }
  }
}
