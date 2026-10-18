import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiParam } from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/errors/error-response.dto.js';
import { BEARER_AUTH } from '../../../swagger.js';
import { OrgRole } from '../entities/org-member.entity.js';
import { MIN_ORG_ROLE_KEY, ORG_ID_PARAM, OrgMemberGuard } from '../guards/org-member.guard.js';

/**
 * Requires membership of the route's workspace (:orgId) with at least
 * `role` (owner > admin > member), and documents that in Swagger.
 *
 *   @RequireOrgRole(OrgRole.Admin)
 *   @Patch(':orgId')
 *   update(@CurrentOrgMember() me: OrgMembership) { ... }
 */
export function RequireOrgRole(role: OrgRole = OrgRole.Member) {
  return applyDecorators(
    SetMetadata(MIN_ORG_ROLE_KEY, role),
    UseGuards(OrgMemberGuard),
    ApiBearerAuth(BEARER_AUTH),
    ApiParam({ name: ORG_ID_PARAM, format: 'uuid' }),
    ApiNotFoundResponse({ description: 'No such workspace, or not a member (ORG_NOT_FOUND)', type: ErrorResponseDto }),
    ...(role === OrgRole.Member
      ? []
      : [
          ApiForbiddenResponse({
            description: `Requires the ${role} role or higher (INSUFFICIENT_ORG_ROLE)`,
            type: ErrorResponseDto,
          }),
        ]),
  );
}
