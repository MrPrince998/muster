import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { OrgRole } from '../../entities/org-member.entity.js';

// ownership moves only through transfer-ownership
const ASSIGNABLE_ROLES = [OrgRole.Admin, OrgRole.Moderator, OrgRole.Member] as const;
export type AssignableOrgRole = (typeof ASSIGNABLE_ROLES)[number];

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_ROLES, description: 'Must be below your own role' })
  @IsIn(ASSIGNABLE_ROLES)
  role: AssignableOrgRole;
}

export class TransferOwnershipDto {
  /** The member who becomes the owner. You become an admin. */
  @IsUUID()
  userId: string;
}

export class OrgMemberDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ description: 'Only shown to moderators and above' })
  email?: string;

  @ApiProperty({ enum: Object.values(OrgRole) })
  role: OrgRole;

  @ApiProperty()
  joinedAt: Date;
}
