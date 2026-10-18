import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionModule } from '../permission/permission.module.js';
import { Event } from './entities/event.entity.js';
import { EventController } from './event.controller.js';
import { EventService } from './event.service.js';

@Module({
  // PermissionModule: every route here is guarded by @RequirePermission()
  imports: [TypeOrmModule.forFeature([Event]), PermissionModule],
  controllers: [EventController],
  providers: [EventService],
  // registrations reuse its tenant scoping and event lookups
  exports: [EventService],
})
export class EventModule {}
