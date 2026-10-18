import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionModule } from '../permission/permission.module.js';
import { Invite } from './entities/invite.entity.js';
import { JoinRequest } from './entities/join-request.entity.js';
import { ClubInviteController, InviteLinkController } from './invite.controller.js';
import { InviteService } from './invite.service.js';

@Module({
  // PermissionModule: the club routes are guarded by @RequirePermission()
  imports: [TypeOrmModule.forFeature([Invite, JoinRequest]), PermissionModule],
  controllers: [ClubInviteController, InviteLinkController],
  providers: [InviteService],
})
export class InviteModule {}
