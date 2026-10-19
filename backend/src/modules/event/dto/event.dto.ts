import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EventStatus, EventVisibility, REPEAT_EVERY, type RepeatEvery } from '../entities/event.entity.js';

const VISIBILITIES = Object.values(EventVisibility);
export const EVENT_SCOPES = ['upcoming', 'past', 'drafts'] as const;
export type EventScope = (typeof EVENT_SCOPES)[number];

export class ListEventsQuery {
  @ApiPropertyOptional({
    enum: EVENT_SCOPES,
    default: 'upcoming',
    description:
      'upcoming: published or cancelled, not ended, soonest first. past: published or cancelled, ended, latest first. drafts: unpublished, only those you can manage.',
  })
  @IsOptional()
  @IsIn(EVENT_SCOPES)
  scope?: EventScope;
}

export const SERIES_SCOPES = ['this', 'following'] as const;
export type SeriesScope = (typeof SERIES_SCOPES)[number];

/** For an event in a series: change just this one, or this and the ones after it. */
export class SeriesScopeQuery {
  @ApiPropertyOptional({ enum: SERIES_SCOPES, default: 'this' })
  @IsOptional()
  @IsIn(SERIES_SCOPES)
  scope?: SeriesScope;
}

export class RepeatDto {
  @ApiProperty({ enum: REPEAT_EVERY })
  @IsIn(REPEAT_EVERY)
  every: RepeatEvery;

  /** How many events in all, the first included. @example 8 */
  @IsInt()
  @Min(2)
  @Max(52)
  count: number;
}

export class CreateEventDto {
  /** @example 'Hack Night' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** A room, an address or a meeting link. @example 'Engineering Hall B' */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  /** ISO 8601 with a time zone. @example '2026-10-24T18:30:00+10:00' */
  @IsDateString({ strict: true })
  startsAt: string;

  /** Must be after startsAt. @example '2026-10-24T22:00:00+10:00' */
  @IsDateString({ strict: true })
  endsAt: string;

  /** Most active registrations; null or left out for no limit. @example 60 */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity?: number | null;

  @ApiPropertyOptional({ enum: VISIBILITIES, default: EventVisibility.Members })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: EventVisibility;

  /**
   * Repeat it: the same event every week, fortnight or month, at the same
   * local time in the workspace's zone. Each one is its own event, with its
   * own places and tickets.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => RepeatDto)
  repeat?: RepeatDto;

  /** Publish straight away (needs event.publish) instead of saving a draft. */
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

// publishing and cancelling have their own routes, so an edit never changes the status
export class UpdateEventDto extends PartialType(OmitType(CreateEventDto, ['publish', 'repeat'] as const)) {
  /** false stops new registrations (the event still runs); true opens them again. */
  @IsOptional()
  @IsBoolean()
  registrationOpen?: boolean;
}

export class CancelEventDto {
  /** Sent to everyone registered with the cancellation. @example 'The speaker is ill.' */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class EventSeriesDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: REPEAT_EVERY })
  every: RepeatEvery;

  @ApiProperty({ description: 'Which one this is, from 1, by date' })
  index: number;

  @ApiProperty({ description: 'How many events the series has' })
  count: number;
}

export class EventDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  clubId: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  location: string | null;

  @ApiProperty()
  startsAt: Date;

  @ApiProperty()
  endsAt: Date;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null: no limit' })
  capacity: number | null;

  @ApiProperty({ enum: VISIBILITIES })
  visibility: EventVisibility;

  @ApiProperty({ enum: Object.values(EventStatus) })
  status: EventStatus;

  @ApiProperty({ description: 'Whether new registrations are taken (closing them early keeps the event running)' })
  registrationOpen: boolean;

  @ApiPropertyOptional({ type: Date, nullable: true })
  cancelledAt: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The organisers' note with the cancellation" })
  cancelReason: string | null;

  @ApiProperty({ description: 'Active registrations (checked-in ones included)' })
  registeredCount: number;

  @ApiProperty({ description: 'Checked in at the door' })
  attendedCount: number;

  @ApiProperty({ description: 'Whether you hold an active registration' })
  youreGoing: boolean;

  @ApiProperty({ description: 'People waiting for a place' })
  waitlistCount: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Your place on the waitlist, from 1; null if not waiting' })
  yourWaitlistPosition: number | null;

  @ApiProperty({ description: 'Whether you may edit it (event.manage_any, or event.manage_own as its creator)' })
  canManage: boolean;

  @ApiPropertyOptional({ type: EventSeriesDto, nullable: true, description: 'The series it repeats in; null for a one-off' })
  series: EventSeriesDto | null;
}

export class EventAttendeeDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  registeredAt: Date;

  @ApiPropertyOptional({ type: Date, nullable: true })
  checkedInAt: Date | null;
}

export class MyRegistrationDto {
  @ApiProperty({ format: 'uuid', description: 'The ticket id' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  eventId: string;

  @ApiProperty()
  registeredAt: Date;
}
