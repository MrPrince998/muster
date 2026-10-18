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
import { TicketService } from './ticket.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Registration]), EventModule, PermissionModule, EmailModule],
  controllers: [RegistrationController, TicketController, PublicController],
  providers: [RegistrationService, TicketService, GuestService, ReminderService],
})
export class RegistrationModule {}
