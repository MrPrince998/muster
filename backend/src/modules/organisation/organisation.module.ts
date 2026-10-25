import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClubModule } from '../club/club.module.js';
import { OrgClubController } from './clubs/org-club.controller.js';
import { OrgClubService } from './clubs/org-club.service.js';
import { EmailModule } from '../email/email.module.js';
import { Organisation } from './entities/organisation.entity.js';
import { OrgMember } from './entities/org-member.entity.js';
import { OrgJoinRequest } from './entities/org-join-request.entity.js';
import { OrgMemberGuard } from './guards/org-member.guard.js';
import { OrgMemberController } from './members/org-member.controller.js';
import { OrgMemberService } from './members/org-member.service.js';
import { OrganisationController } from './organisation.controller.js';
import { OrgJoinRequestController } from './join-requests/org-join-request.controller.js';
import { OrgJoinRequestService } from './join-requests/org-join-request.service.js';
import { OrganisationService } from './organisation.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Organisation, OrgMember, OrgJoinRequest]), ClubModule, EmailModule],
  controllers: [OrganisationController, OrgMemberController, OrgJoinRequestController, OrgClubController],
  providers: [OrganisationService, OrgMemberService, OrgJoinRequestService, OrgClubService, OrgMemberGuard],
  // other modules use @RequireOrgRole() for workspace-level routes; a club's link can ask to join the workspace
  exports: [OrgMemberService, OrgMemberGuard, OrgJoinRequestService],
})
export class OrganisationModule {}
