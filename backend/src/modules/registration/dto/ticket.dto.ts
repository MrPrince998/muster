import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** A ticket you hold, as the app shows it. */
export class TicketDto {
  @ApiProperty({ format: 'uuid' })
  registrationId: string;

  @ApiProperty({ format: 'uuid' })
  eventId: string;

  @ApiProperty({ format: 'uuid' })
  clubId: string;

  @ApiProperty()
  clubName: string;

  @ApiProperty()
  workspaceName: string;

  @ApiProperty()
  workspaceSlug: string;

  @ApiProperty()
  eventTitle: string;

  @ApiProperty()
  startsAt: Date;

  @ApiProperty()
  endsAt: Date;

  @ApiPropertyOptional({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ description: 'The event was called off; the ticket no longer gets anyone in' })
  eventCancelled: boolean;

  @ApiProperty()
  attendeeName: string;

  @ApiPropertyOptional({ type: Date, nullable: true, description: 'When it was scanned at the door' })
  checkedInAt: Date | null;

  @ApiProperty({ example: 'Australia/Sydney', description: "The event's workspace's time zone: show its times in it" })
  timeZone: string;
}

/** One ticket with what the door needs: the signed token and its QR code. */
export class TicketWithCodeDto extends TicketDto {
  @ApiProperty({ description: 'The signed ticket (what the QR code holds)' })
  token: string;

  @ApiProperty({ description: 'The QR code as SVG markup' })
  qrSvg: string;
}

export class CheckInDto {
  /** What the scanner read from the QR code */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  token: string;
}

export class ManualCheckInDto {
  /** The attendee, picked from the list when their phone or ticket fails */
  @IsUUID()
  userId: string;
}

export const CHECK_IN_OUTCOMES = ['checked_in', 'already_checked_in', 'cancelled', 'wrong_event', 'invalid'] as const;
export type CheckInOutcome = (typeof CHECK_IN_OUTCOMES)[number];

/**
 * Every scan gets an answer the door can act on; only a missing permission
 * or event is an HTTP error.
 */
export class CheckInResultDto {
  @ApiProperty({
    enum: CHECK_IN_OUTCOMES,
    description:
      'checked_in: let them in. already_checked_in: this ticket was used. cancelled: they gave their place back. wrong_event: a genuine ticket for another event. invalid: not a ticket (forged, damaged, expired, or not ours).',
  })
  outcome: CheckInOutcome;

  @ApiPropertyOptional({ description: 'Whose ticket it is, when known' })
  attendeeName?: string;

  @ApiPropertyOptional({ description: 'When it was checked in (now, or the earlier use)' })
  checkedInAt?: Date;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Who scanned it the first time' })
  checkedInByName?: string | null;

  @ApiProperty({ description: 'People in so far' })
  attendedCount: number;

  @ApiProperty({ description: 'People registered' })
  registeredCount: number;
}

/** One ticket on the door's list. */
export class DoorTicketDto {
  @ApiProperty({ format: 'uuid', description: "The registration id: what a ticket's code carries" })
  registrationId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ type: Date, nullable: true })
  checkedInAt: Date | null;

  @ApiProperty({ description: 'They gave their place back: the ticket gets nobody in' })
  cancelled: boolean;
}

/** GET .../check-in/roster: everything a scanner needs to keep checking tickets with no connection. */
export class DoorRosterDto {
  @ApiProperty({ format: 'uuid' })
  eventId: string;

  @ApiProperty({ description: 'When the list was read; anything since then is in the sync' })
  generatedAt: Date;

  @ApiProperty({ type: [DoorTicketDto] })
  tickets: DoorTicketDto[];
}

export class OfflineCheckInDto {
  @IsUUID()
  registrationId: string;

  /** When the door let them in, on the scanner's clock. @example '2026-10-24T18:42:10Z' */
  @IsDateString({ strict: true })
  at: string;
}

export class OfflineCheckInsDto {
  /** What the scanner let in while offline, oldest first. */
  @ApiProperty({ type: [OfflineCheckInDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OfflineCheckInDto)
  checkIns: OfflineCheckInDto[];
}

export class SyncedCheckInDto {
  @ApiProperty({ format: 'uuid' })
  registrationId: string;

  @ApiProperty({
    enum: ['checked_in', 'already_checked_in', 'cancelled', 'invalid'],
    description:
      'checked_in: recorded. already_checked_in: someone used it first (another door, or before the place was given back): the door should know.',
  })
  outcome: Exclude<CheckInOutcome, 'wrong_event'>;

  @ApiPropertyOptional()
  attendeeName?: string;

  @ApiPropertyOptional()
  checkedInAt?: Date;

  @ApiPropertyOptional({ type: String, nullable: true })
  checkedInByName?: string | null;
}

export class SyncResultDto {
  @ApiProperty({ type: [SyncedCheckInDto] })
  results: SyncedCheckInDto[];

  @ApiProperty({ description: 'People in so far' })
  attendedCount: number;

  @ApiProperty({ description: 'People registered' })
  registeredCount: number;
}
