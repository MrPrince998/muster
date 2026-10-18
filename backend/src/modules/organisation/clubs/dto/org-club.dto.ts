import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALL_PERMISSIONS, type Permission } from '../../../permission/permissions.js';

export class CreateClubDto {
  /** @example 'Coding Club' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** @example 'Weekly build nights and the spring hackathon.' */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** A club you belong to, with what you may do in it. */
export class ClubSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Unique within the workspace' })
  slug: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ description: "The workspace's default club; everyone who joins is in it" })
  isDefault: boolean;

  @ApiProperty()
  memberCount: number;

  @ApiProperty({ description: 'Published events that have not started yet' })
  upcomingCount: number;

  @ApiProperty({ description: 'People waiting for approval to join; 0 unless you have member.approve' })
  pendingJoinRequests: number;

  @ApiProperty({
    enum: ALL_PERMISSIONS,
    isArray: true,
    description: 'Your permissions in this club (the Owner role has all of them)',
  })
  permissions: Permission[];
}
