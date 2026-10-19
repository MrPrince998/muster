import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule } from '../email/email.module.js';
import { EventModule } from '../event/event.module.js';
import { PermissionModule } from '../permission/permission.module.js';
import { Registration } from './entities/registration.entity.js';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';
import { TicketController } from './ticket.controller.js';
import { GuestService } from './guest.service.js';
import { PublicController } from './public.controller.js';
import { ReminderService } from './reminder.service.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { WaitlistModule } from '../waitlist/waitlist.module.js';
import { PaymentModule } from '../payment/payment.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Registration]), EventModule, PermissionModule, EmailModule, TicketModule, WaitlistModule, PaymentModule],
  controllers: [RegistrationController, TicketController, PublicController],
  providers: [RegistrationService, GuestService, ReminderService],
})
export class RegistrationModule {}
