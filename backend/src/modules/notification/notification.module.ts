import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { PermissionModule } from '../permission/permission.module.js';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';

/** New-event emails: as they're published, or weekly. */
@Module({
  imports: [EmailModule, PermissionModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
