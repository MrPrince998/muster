import { Logger, Module } from '@nestjs/common';
import { Resend } from 'resend';
import { config } from '../../config/config.js';
import { EmailSender, LogEmailSender, ResendEmailSender, SkipReservedDomains } from './email-sender.js';
import { APP_URL, BULK_PACE_MS, EmailService } from './email.service.js';

@Module({
  providers: [
    EmailService,
    { provide: APP_URL, useValue: config.appUrl },
    // under 2 a second: Resend's default rate limit
    { provide: BULK_PACE_MS, useValue: 600 },
    {
      provide: EmailSender,
      useFactory: (): EmailSender => {
        const { resendApiKey, from } = config.email;
        if (resendApiKey) return new SkipReservedDomains(new ResendEmailSender(new Resend(resendApiKey), from));
        new Logger('Email').warn('RESEND_API_KEY is not set: emails are logged, not sent');
        return new LogEmailSender();
      },
    },
  ],
  exports: [EmailService, BULK_PACE_MS],
})
export class EmailModule {}
