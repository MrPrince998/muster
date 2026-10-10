import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Club } from './entities/club.entity.js';
import { ClubMember } from './entities/club-member.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Club, ClubMember])],
})
export class ClubModule {}
