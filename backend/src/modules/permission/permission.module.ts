import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './entities/role.entity.js';
import { MemberRole } from './entities/member-role.entity.js';
import { PermissionService } from './permission.service.js';
import { PermissionGuard } from './guards/permission.guard.js';

@Module({
  imports: [TypeOrmModule.forFeature([Role, MemberRole])],
  providers: [PermissionService, PermissionGuard],
  // any module using @RequirePermission() must import PermissionModule
  exports: [PermissionService, PermissionGuard],
})
export class PermissionModule {}
