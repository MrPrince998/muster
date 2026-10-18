import { ApiProperty } from '@nestjs/swagger';
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
