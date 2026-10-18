import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { PermissionModule } from '../permission/permission.module.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { WaitlistController } from './waitlist.controller.js';
import { WaitlistService } from './waitlist.service.js';

/**
 * Waitlists. Events (a capacity change) and registrations (a place given
 * back) both promote from it, so it depends on neither.
 */
@Module({
  imports: [PermissionModule, EmailModule, TicketModule],
  controllers: [WaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
