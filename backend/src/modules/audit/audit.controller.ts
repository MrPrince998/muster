import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentOrgMember } from '../organisation/decorators/current-org-member.decorator.js';
import { RequireOrgRole } from '../organisation/decorators/require-org-role.decorator.js';
import { OrgRole } from '../organisation/entities/org-member.entity.js';
import type { OrgMembership } from '../organisation/org-roles.js';
import { AuditPageDto, AuditQuery } from './dto/audit.dto.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit log')
@Controller('orgs/:orgId/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Who changed what in the workspace, newest first
   *
   * @remarks For the owner and admins. Roles, members, events, invites,
   * settings, exports and check-ins by name, each with who and when.
   */
  @Get()
  @RequireOrgRole(OrgRole.Admin)
  @ApiOkResponse({ type: AuditPageDto })
  page(@CurrentOrgMember() me: OrgMembership, @Query() query: AuditQuery): Promise<AuditPageDto> {
    return this.audit.page(me, query);
  }
}
