import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganisationService } from './organisation.service.js';
import { OrganisationController } from './organisation.controller.js';
import { Organisation } from './entities/organisation.entity.js';
import { OrgMember } from './entities/org-member.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Organisation, OrgMember])],
  controllers: [OrganisationController],
  providers: [OrganisationService],
})
export class OrganisationModule {}
