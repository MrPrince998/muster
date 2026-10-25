import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OrgJoinRequestStatus } from '../../entities/org-join-request.entity.js';
import { JoinPolicy } from '../../entities/organisation.entity.js';
import { OrganisationDto } from '../../dto/organisation.dto.js';

const STATUSES = Object.values(OrgJoinRequestStatus);

export class JoinOrganisationDto {
  /**
   * Note to the moderators, for workspaces that review requests
   * @example "I'm a second-year student in the robotics lab"
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class ListJoinRequestsQuery {
  @ApiPropertyOptional({ enum: STATUSES, default: OrgJoinRequestStatus.Pending })
  @IsOptional()
  @IsIn(STATUSES)
  status?: OrgJoinRequestStatus;

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

export class MyJoinRequestDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: STATUSES })
  status: OrgJoinRequestStatus;

  @ApiProperty()
  createdAt: Date;
}

export class JoinResultDto {
  @ApiProperty({
    enum: ['joined', 'requested'],
    description: 'joined: you are a member now. requested: a moderator will review your request.',
  })
  status: 'joined' | 'requested';

  @ApiPropertyOptional({ type: () => OrganisationDto, description: 'When joined' })
  organisation?: OrganisationDto;

  @ApiPropertyOptional({ type: () => MyJoinRequestDto, description: 'When requested' })
  request?: MyJoinRequestDto;
}

/** What someone outside a workspace may see before joining or asking to. */
export class OrganisationPreviewDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ enum: Object.values(JoinPolicy) })
  joinPolicy: JoinPolicy;

  @ApiProperty()
  memberCount: number;

  @ApiProperty()
  isMember: boolean;

  @ApiProperty({ type: () => MyJoinRequestDto, nullable: true, description: 'Your pending request, if any' })
  pendingRequest: MyJoinRequestDto | null;
}

/** A request as moderators see it. */
export class JoinRequestDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ type: String, nullable: true })
  message: string | null;

  @ApiProperty({ enum: STATUSES })
  status: OrgJoinRequestStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  decidedAt: Date | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  decidedBy: string | null;
}

export class JoinRequestsPageDto {
  @ApiProperty({ type: [JoinRequestDto] })
  requests: JoinRequestDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Pass as `after` for the next page; null at the end' })
  next: string | null;

  @ApiProperty({ description: 'How many have this status' })
  total: number;
}
