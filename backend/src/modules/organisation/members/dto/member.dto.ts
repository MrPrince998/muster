import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
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

/** A page of the members list: ?q= filters, ?after= continues. */
export class MembersQuery {
  /** Part of a name (or, for staff, an email) */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  /** The `next` of the page before */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  after?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class OrgMembersPageDto {
  @ApiProperty({ type: [OrgMemberDto] })
  members: OrgMemberDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Pass as `after` for the next page; null at the end' })
  next: string | null;

  @ApiProperty({ description: 'How many you can see in all (ignoring q): everyone, for staff' })
  total: number;
}
