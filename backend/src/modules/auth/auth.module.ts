import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '../../config/config.js';
import { EmailModule } from '../email/email.module.js';
import { UserModule } from '../user/user.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailTokenService } from './email-token.service.js';
import { EmailToken } from './entities/email-token.entity.js';
import { Session } from './entities/session.entity.js';
import { AuthGuard } from './guards/auth.guard.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, EmailToken]),
    UserModule,
    EmailModule,
    JwtModule.register({
      secret: config.jwt.secret,
      // pinned algorithm: a token claiming "none" or RS256 is rejected
      signOptions: {
        algorithm: 'HS256',
        expiresIn: config.jwt.expiresIn as JwtSignOptions['expiresIn'],
      },
      verifyOptions: { algorithms: ['HS256'] },
    }),
    // per client IP; routes opt in with ThrottlerGuard and tune with @Throttle
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 30 }],
      errorMessage: 'Too many attempts. Try again in a minute.',
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    EmailTokenService,
    AccessTokenService,
    // every route in the app requires sign-in unless marked @Public()
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
