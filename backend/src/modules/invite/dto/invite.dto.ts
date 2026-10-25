import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

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

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Their note, when they asked from the club list' })
  message: string | null;

  @ApiProperty({ description: 'They came through an invite link (otherwise they asked from the club list)' })
  viaLink: boolean;

  @ApiProperty()
  createdAt: Date;
}

/** A page of a club's join requests: ?after= continues. */
export class ClubJoinRequestsQuery {
  /** The `next` of the page before */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  after?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ClubJoinRequestsPageDto {
  @ApiProperty({ type: [ClubJoinRequestDto] })
  requests: ClubJoinRequestDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Pass as `after` for the next page; null at the end' })
  next: string | null;

  @ApiProperty({ description: 'How many are waiting' })
  total: number;
}

/** A club in the workspace's directory, as one member sees it. */
export class ClubDirectoryEntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: "In the club's link: /c/{workspace}/{club}" })
  slug: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ enum: ['open', 'request', 'invite'] })
  joinPolicy: 'open' | 'request' | 'invite';

  @ApiProperty()
  memberCount: number;

  @ApiProperty()
  upcomingCount: number;

  @ApiProperty({ description: "You're in it" })
  isMember: boolean;

  @ApiProperty({ description: "You've asked to join, and nobody has decided yet" })
  requested: boolean;
}

export class JoinClubDto {
  /** A note for the people deciding (clubs that ask). @example 'I built a robot arm last term.' */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class JoinClubResultDto {
  @ApiProperty({ enum: ['joined', 'requested'], description: "joined: you're in. requested: the club's approvers decide." })
  status: 'joined' | 'requested';
}

/** GET /club-links/:orgSlug/:clubSlug: where a club's link leads, before joining. */
export class ClubLinkPreviewDto {
  @ApiProperty()
  workspaceName: string;

  @ApiProperty()
  workspaceSlug: string;

  @ApiProperty({ enum: ['open', 'request', 'invite'] })
  workspaceJoinPolicy: 'open' | 'request' | 'invite';

  @ApiProperty({ description: "You're in the workspace" })
  inWorkspace: boolean;

  @ApiProperty({ description: "You've asked to join the workspace, and nobody has decided yet" })
  workspaceRequested: boolean;

  @ApiProperty({ format: 'uuid' })
  clubId: string;

  @ApiProperty()
  clubName: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ description: "The workspace's General club: joining it is joining the workspace" })
  isDefault: boolean;

  @ApiProperty({ enum: ['open', 'request', 'invite'] })
  joinPolicy: 'open' | 'request' | 'invite';

  @ApiProperty()
  memberCount: number;

  @ApiProperty({ description: "You're in the club" })
  isMember: boolean;

  @ApiProperty({ description: "You've asked to join the club, and nobody has decided yet" })
  requested: boolean;
}

export class ClubLinkJoinResultDto {
  @ApiProperty({
    enum: ['joined', 'requested', 'workspace_requested'],
    description:
      "joined: you're in (and in the workspace). requested: the club's approvers decide. " +
      "workspace_requested: the workspace asks first; its moderators decide, then open the link again.",
  })
  status: 'joined' | 'requested' | 'workspace_requested';

  @ApiProperty()
  workspaceSlug: string;

  @ApiProperty({ format: 'uuid' })
  clubId: string;
}

