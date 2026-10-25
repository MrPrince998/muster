import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, IsObject, IsOptional, IsUUID } from 'class-validator';
import { PriceDto, QuestionDto, TicketTypeDto } from '../../event/dto/event.dto.js';
import { DirectPaymentDto } from '../../payment/dto/direct-payment.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** A public event, as anyone with the link sees it. */
export class PublicEventDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) location: string | null;
  @ApiProperty() startsAt: Date;
  @ApiProperty() endsAt: Date;
  @ApiProperty({ enum: ['published', 'cancelled'] }) status: 'published' | 'cancelled';
  @ApiPropertyOptional({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty({ description: 'Over already' }) ended: boolean;
  @ApiProperty({ description: 'Taking registrations (closing them early keeps the event running)' })
  registrationOpen: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null: no limit; 0 while anyone is waiting' })
  placesLeft: number | null;
  @ApiProperty({ description: 'People waiting for a place' }) waitlistCount: number;
  @ApiProperty() clubName: string;
  @ApiProperty() workspaceName: string;
  @ApiProperty({ example: 'Australia/Sydney', description: 'The time zone the event is held in (IANA name)' })
  timeZone: string;

  @ApiPropertyOptional({ type: PriceDto, nullable: true, description: 'A ticket costs this; null: free' })
  price: PriceDto | null;

  @ApiProperty({ type: [QuestionDto], description: 'What people taking a place are asked' })
  questions: QuestionDto[];

  @ApiProperty({ type: [TicketTypeDto], description: 'The tickets on offer to the public; none: free' })
  ticketTypes: TicketTypeDto[];

  @ApiProperty({ description: 'Discount codes work for this event: offer a box for one' })
  hasCodes: boolean;

  @ApiProperty({ description: 'Tickets are paid to the organisers directly, not through Stripe' })
  payDirectly: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Its cover image, a path on the API (/files/...)' })
  coverUrl: string | null;
}

export class GuestPlaceDto {
  /** As it should appear on the ticket. @example 'Ada Lovelace' */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** Where the confirmation link and the ticket go. @example 'ada@example.org' */
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email: string;

  /** Needed when more than one ticket is on offer */
  @IsOptional()
  @IsUUID()
  ticketTypeId?: string;

  /** A discount code */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  /** Answers to the event's questions, by question id */
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  @IsObject()
  answers?: Record<string, string>;
}

export class ConfirmGuestPlaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  token: string;
}

/** Either a ticket, or (the event being full) a place in the queue. */
export class GuestPlaceResultDto {
  @ApiPropertyOptional({ description: 'The signed ticket; also the key to its page, /t/{ticketToken}' })
  ticketToken?: string;

  @ApiPropertyOptional({ description: 'Full: their place on the waitlist, from 1' })
  waitlistPosition?: number;

  @ApiPropertyOptional({ description: 'A paid event: Stripe checkout, where the place is bought (held half an hour)' })
  checkoutUrl?: string;

  @ApiPropertyOptional({
    type: () => DirectPaymentDto,
    description: 'A paid event whose organisers are paid directly: the place held, and how to pay for it (also emailed)',
  })
  payment?: DirectPaymentDto;
}
