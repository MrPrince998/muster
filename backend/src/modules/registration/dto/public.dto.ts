import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

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
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null: no limit' }) placesLeft: number | null;
  @ApiProperty() clubName: string;
  @ApiProperty() workspaceName: string;
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
}

export class ConfirmGuestPlaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  token: string;
}

export class GuestPlaceResultDto {
  @ApiProperty({ description: 'The signed ticket; also the key to its page, /t/{ticketToken}' })
  ticketToken: string;
}
