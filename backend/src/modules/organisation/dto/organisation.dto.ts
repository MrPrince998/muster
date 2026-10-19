import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { JoinPolicy } from '../entities/organisation.entity.js';
import { OrgRole } from '../entities/org-member.entity.js';
import { IsTimeZone } from '../../../common/validators/is-time-zone.js';
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, SLUG_PATTERN } from '../slug.js';

const JOIN_POLICIES = Object.values(JoinPolicy);

export class CreateOrganisationDto {
  /** @example 'State University' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /**
   * URL name (/o/state-uni). Generated from the name if omitted.
   * @example state-uni
   */
  @IsOptional()
  @IsString()
  @MinLength(SLUG_MIN_LENGTH)
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: 'slug may contain lowercase letters, digits and single hyphens' })
  slug?: string;

  @ApiPropertyOptional({ enum: JOIN_POLICIES, default: JoinPolicy.Invite })
  @IsOptional()
  @IsIn(JOIN_POLICIES)
  joinPolicy?: JoinPolicy;

  /**
   * Where the clubs meet: event times are shown and emailed in it. Defaults
   * to the server's APP_TIME_ZONE. @example Australia/Sydney
   */
  @IsOptional()
  @IsTimeZone()
  timeZone?: string;
}

export class UpdateOrganisationDto extends PartialType(CreateOrganisationDto) {}

export class DeleteOrganisationDto {
  /** Type the workspace's slug to confirm. Deletes every club, event and registration in it. */
  @IsString()
  @IsNotEmpty()
  confirmSlug: string;
}

export class OrganisationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ enum: JOIN_POLICIES })
  joinPolicy: JoinPolicy;

  @ApiProperty({ example: 'Australia/Sydney', description: 'Event times are in this zone' })
  timeZone: string;

  @ApiProperty({ enum: Object.values(OrgRole), description: 'Your role in this workspace' })
  role: OrgRole;

  @ApiPropertyOptional({
    description: 'Join requests waiting for review. Only included for moderators and above.',
    example: 3,
  })
  pendingJoinRequests?: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class MyOrganisationDto {
  @ApiProperty({ format: 'uuid' })
  orgId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ enum: Object.values(OrgRole) })
  role: string;

  @ApiProperty()
  joinedAt: Date;

  @ApiProperty({ example: 'Australia/Sydney', description: 'Event times are in this zone' })
  timeZone: string;
}
