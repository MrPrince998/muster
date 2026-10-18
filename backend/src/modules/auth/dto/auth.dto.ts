import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { User } from '../../user/entities/user.entity.js';

// Upper bound on any password we accept. Generous enough for passphrases and
// password managers, small enough that a request cannot make scrypt hash
// megabytes of input.
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_MIN_LENGTH = 8;

// tokens from generateToken() are 43 base64url characters; a little slack
const TOKEN_MAX_LENGTH = 128;

// Where to take someone after they confirm their email, e.g. back to the
// invite link they signed up from. A path on the frontend only: "/" then not
// "/" or "\", so it can never become a link to another site.
export const NEXT_PATH_PATTERN = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;
const NEXT_PATH_MAX_LENGTH = 300;

class WithNextPath {
  /** A page on the app to return to after confirming. @example '/join/zKcOC5xfLs1lWhpCXnFB1g' */
  @IsOptional()
  @IsString()
  @MaxLength(NEXT_PATH_MAX_LENGTH)
  @Matches(NEXT_PATH_PATTERN, { message: 'next must be a path on this site, like /join/abc' })
  next?: string;
}

export class SignUpDto extends WithNextPath {
  /** @example ada@example.com */
  @IsEmail()
  @MaxLength(320)
  email: string;

  /** @example 'Ada Lovelace' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** @example 'correct horse battery staple' */
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class SignInDto {
  /** @example ada@example.com */
  @IsEmail()
  @MaxLength(320)
  email: string;

  // no MinLength: a too-short password should fail as "invalid credentials",
  // not reveal the password rules
  /** @example 'correct horse battery staple' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class EmailDto {
  /** @example ada@example.com */
  @IsEmail()
  @MaxLength(320)
  email: string;
}

export class ResendVerificationDto extends WithNextPath {
  /** @example ada@example.com */
  @IsEmail()
  @MaxLength(320)
  email: string;
}

export class TokenDto {
  /** The token from the emailed link */
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOKEN_MAX_LENGTH)
  token: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

/** What you can change about yourself. Email changes need re-verification, so not here. */
export class UpdateProfileDto {
  /** @example 'Ada Lovelace' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

/** Sign-in and refresh response. The refresh token is set as an httpOnly cookie, never returned here. */
export class AuthTokensDto {
  @ApiProperty({ description: 'Send as `Authorization: Bearer <accessToken>`' })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ description: 'Seconds until the access token expires', example: 900 })
  expiresIn: number;

  @ApiProperty({ type: () => User })
  user: User;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true })
  userAgent: string | null;

  @ApiProperty({ type: String, nullable: true })
  ip: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  lastUsedAt: Date;

  @ApiProperty({ description: 'The session making this request' })
  current: boolean;
}
