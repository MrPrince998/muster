import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

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
