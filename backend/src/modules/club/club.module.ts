import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Club } from './entities/club.entity.js';
import { ClubMember } from './entities/club-member.entity.js';
import { PermissionModule } from '../permission/permission.module.js';
import { ClubMemberController, ClubRoleController } from './club-admin.controller.js';
import { ClubAdminService } from './club-admin.service.js';
import { ClubService } from './club.service.js';

@Module({
  // PermissionModule: the members and roles routes are guarded by @RequirePermission()
  imports: [TypeOrmModule.forFeature([Club, ClubMember]), PermissionModule],
  controllers: [ClubMemberController, ClubRoleController],
  providers: [ClubService, ClubAdminService],
  exports: [ClubService],
})
export class ClubModule {}
