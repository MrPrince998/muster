import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Club } from './entities/club.entity.js';
import { ClubMember } from './entities/club-member.entity.js';
import { ClubService } from './club.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Club, ClubMember])],
  providers: [ClubService],
  exports: [ClubService],
})
export class ClubModule {}
