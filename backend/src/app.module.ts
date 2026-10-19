import { ClassSerializerInterceptor, Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { DatabaseModule } from './database/database.module.js';
import { UserModule } from './modules/user/user.module.js';
import { OrganisationModule } from './modules/organisation/organisation.module.js';
import { ClubModule } from './modules/club/club.module.js';
import { PermissionModule } from './modules/permission/permission.module.js';
import { EventModule } from './modules/event/event.module.js';
import { RegistrationModule } from './modules/registration/registration.module.js';
import { InviteModule } from './modules/invite/invite.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { FeedModule } from './modules/feed/feed.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { FeedbackModule } from './modules/feedback/feedback.module.js';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    OrganisationModule,
    ClubModule,
    PermissionModule,
    InviteModule,
    EventModule,
    RegistrationModule,
    AuthModule,
    SearchModule,
    AnalyticsModule,
    FeedModule,
    NotificationModule,
    FeedbackModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        // strip unknown fields and reject requests that send them, so a client
        // can never set columns like passwordHash through a DTO
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    // applies @Exclude() / @Expose() from entities to every response
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
  ],
})
export class AppModule {}
