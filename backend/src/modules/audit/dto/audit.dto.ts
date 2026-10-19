import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AuditAction } from '../audit.js';

export class AuditQuery {
  /** Only this club's lines */
  @IsOptional()
  @IsUUID()
  clubId?: string;

  /** The `next` of the page before: lines older than it */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  at: Date;

  @ApiProperty({ enum: Object.values(AuditAction) })
  action: string;

  @ApiProperty({ description: "Who did it (today's name)" })
  actorName: string;

  @ApiProperty({ description: 'What they did, as a sentence to follow their name: "made Ada an admin (was member)"' })
  summary: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  clubId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  clubName: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  eventId: string | null;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditEntryDto] })
  entries: AuditEntryDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Pass as `before` for the next page; null at the end' })
  next: string | null;
}
