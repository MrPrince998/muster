import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invite } from './entities/invite.entity.js';
import { JoinRequest } from './entities/join-request.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Invite, JoinRequest])],
})
export class InviteModule {}
