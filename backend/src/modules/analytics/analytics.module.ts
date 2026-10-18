import { Module } from '@nestjs/common';
import { PermissionModule } from '../permission/permission.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  // PermissionModule: the route is guarded by @RequirePermission()
  imports: [PermissionModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
