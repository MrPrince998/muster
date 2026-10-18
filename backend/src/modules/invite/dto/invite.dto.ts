import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export const INVITE_STATUSES = ['active', 'expired', 'used_up', 'revoked'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export class CreateInviteDto {
  /** Role given on joining; must be below your own. Left out or null: no role. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  defaultRoleId?: string | null;

  /** How many people can use it; left out or null: no limit. @example 25 */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxUses?: number | null;

  /** Days until it stops working; left out or null: never. @example 7 */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number | null;

  /** Each person asks to join; someone with member.approve lets them in. */
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}

export class InviteRoleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class InviteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'The secret in the link: /join/{code}' })
  code: string;

  @ApiProperty({ format: 'uuid' })
  clubId: string;

  @ApiPropertyOptional({ type: InviteRoleDto, nullable: true })
  role: InviteRoleDto | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null: no limit' })
  maxUses: number | null;

  @ApiProperty()
  useCount: number;

  @ApiPropertyOptional({ type: Date, nullable: true, description: 'null: never' })
  expiresAt: Date | null;

  @ApiProperty({ enum: INVITE_STATUSES })
  status: InviteStatus;

  @ApiProperty({ description: 'People ask to join and are approved one by one' })
  requiresApproval: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  createdByName: string | null;

  @ApiProperty()
  createdAt: Date;
}

/** What /join/{code} shows before joining. */
export class InvitePreviewDto {
  @ApiProperty({ enum: INVITE_STATUSES })
  status: InviteStatus;

  @ApiProperty()
  workspaceName: string;

  @ApiProperty()
  workspaceSlug: string;

  @ApiProperty({ format: 'uuid' })
  clubId: string;

  @ApiProperty()
  clubName: string;

  @ApiProperty({ description: "The workspace's default club: the link is really an invite to the workspace" })
  clubIsDefault: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  roleName: string | null;

  @ApiProperty({ description: 'You are already in the club' })
  alreadyMember: boolean;

  @ApiProperty({ description: 'Joining means asking; someone approves each person' })
  requiresApproval: boolean;

  @ApiProperty({ description: 'You already asked and are waiting' })
  pendingRequest: boolean;
}

export const ACCEPT_STATUSES = ['joined', 'already_member', 'requested'] as const;

export class AcceptInviteResultDto {
  @ApiProperty()
  workspaceSlug: string;

  @ApiProperty({ format: 'uuid' })
  clubId: string;

  @ApiProperty({
    enum: ACCEPT_STATUSES,
    description:
      'joined: you are in. already_member: you were in already (no use taken). requested: the link needs approval; you are waiting.',
  })
  status: (typeof ACCEPT_STATUSES)[number];
}

/** A pending ask to join a club through a link that needs approval. */
export class ClubJoinRequestDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The role approving gives (from the link)' })
  roleName: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class ClubRoleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  position: number;

  @ApiProperty({ description: 'Below your own role, so you can give it (e.g. through an invite link)' })
  assignable: boolean;
}
