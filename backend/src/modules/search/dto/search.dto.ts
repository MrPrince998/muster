import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { EventStatus } from '../../event/entities/event.entity.js';

export class SearchQuery {
  /** At least 2 characters, after trimming. @example 'robo' */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;
}

class WorkspaceRef {
  @ApiProperty() orgName: string;
  @ApiProperty() orgSlug: string;
}

export class WorkspaceHit {
  @ApiProperty({ format: 'uuid' }) orgId: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ description: 'Your role there' }) role: string;
}

export class ClubHit extends WorkspaceRef {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

export class EventHit extends WorkspaceRef {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty() startsAt: Date;
  @ApiProperty() endsAt: Date;
  @ApiProperty({ enum: Object.values(EventStatus) }) status: EventStatus;
  @ApiProperty({ description: 'Already over' }) ended: boolean;
  @ApiProperty({ example: 'Australia/Sydney', description: "Its workspace's time zone" }) timeZone: string;
  @ApiProperty({ format: 'uuid' }) clubId: string;
  @ApiProperty() clubName: string;
}

export class PersonHit extends WorkspaceRef {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Their role in that workspace' }) role: string;
}

/** Up to a handful of each kind, best match first. */
export class SearchResultDto {
  @ApiProperty({ type: [WorkspaceHit] }) workspaces: WorkspaceHit[];
  @ApiProperty({ type: [ClubHit] }) clubs: ClubHit[];
  @ApiProperty({ type: [EventHit] }) events: EventHit[];
  @ApiProperty({ type: [PersonHit] }) people: PersonHit[];
}
