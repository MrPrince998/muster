import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule } from '../email/email.module.js';
import { PermissionModule } from '../permission/permission.module.js';
import { WaitlistModule } from '../waitlist/waitlist.module.js';
import { Event } from './entities/event.entity.js';
import { EventController } from './event.controller.js';
import { EventService } from './event.service.js';

@Module({
  // PermissionModule: every route here is guarded by @RequirePermission();
  // EmailModule: cancellations and changes are emailed to the people registered;
  // WaitlistModule: more places (a higher capacity) go to the people waiting
  imports: [TypeOrmModule.forFeature([Event]), PermissionModule, EmailModule, WaitlistModule],
  controllers: [EventController],
  providers: [EventService],
  // registrations reuse its tenant scoping and event lookups
  exports: [EventService],
})
export class EventModule {}
