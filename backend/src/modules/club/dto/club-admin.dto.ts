import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ALL_PERMISSIONS, type Permission } from '../../permission/permissions.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// --- members -----------------------------------------------------------------

export class ClubMemberDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() name: string;
  @ApiProperty() joinedAt: Date;
  @ApiProperty({ description: 'Holds the Owner role' }) isOwner: boolean;
  @ApiProperty({ type: [String], format: 'uuid', description: 'The roles they hold (Owner excluded)' })
  roleIds: string[];
  @ApiProperty({ description: 'Below you in the hierarchy: you may change their roles or remove them' })
  manageable: boolean;
}

export class SetMemberRolesDto {
  /** Every role they should hold, replacing the current set (Owner excluded). */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  roleIds: string[];
}

export class TransferClubDto {
  @IsUUID('4')
  userId: string;
}

// --- roles -------------------------------------------------------------------

export class ClubRoleDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Higher is more senior; the Owner role (not listed) is above all' })
  position: number;
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) permissions: Permission[];
  @ApiProperty({ description: 'How many members hold it' }) memberCount: number;
  @ApiProperty({ description: 'Below your own role, so you can give, edit, move or delete it' })
  assignable: boolean;
}

export class CreateRoleDto {
  /** @example 'Treasurer' */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  /** Only permissions you hold yourself. */
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions: Permission[];
}

export class UpdateRoleDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions?: Permission[];
}

export class MoveRoleDto {
  @ApiProperty({ enum: ['up', 'down'] })
  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}

export const CLUB_JOIN_POLICIES = ['open', 'request', 'invite'] as const;
export type ClubJoinPolicy = (typeof CLUB_JOIN_POLICIES)[number];

export class UpdateClubDto {
  /** @example 'Robotics Society' */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** open: anyone in the workspace joins from the club list. request: they ask, approvers decide. invite: invite links only. */
  @ApiPropertyOptional({ enum: CLUB_JOIN_POLICIES })
  @IsOptional()
  @IsIn(CLUB_JOIN_POLICIES)
  joinPolicy?: ClubJoinPolicy;
}

export class ClubDetailsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ enum: CLUB_JOIN_POLICIES })
  joinPolicy: ClubJoinPolicy;

  @ApiProperty()
  isDefault: boolean;
}
