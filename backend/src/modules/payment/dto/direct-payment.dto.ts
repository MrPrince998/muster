import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DIRECT_CURRENCIES } from '../direct-payment.js';

/** A place held while someone pays the organisers directly: what to pay, how, and by when. */
export class DirectPaymentDto {
  @ApiProperty({ format: 'uuid' })
  checkoutId: string;

  @ApiProperty({ description: 'What to put on the payment, so the organisers can match it', example: 'K7P2QX' })
  reference: string;

  @ApiProperty({ description: "In the currency's smallest unit" })
  amountCents: number;

  @ApiProperty({ description: 'ISO 4217, lowercase' })
  currency: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  ticketType: string | null;

  @ApiProperty({ description: "How to pay, in the organisers' words" })
  instructions: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Their payment QR code, a path on the API (/files/...)' })
  qrUrl: string | null;

  @ApiProperty({ description: 'The place is held until then' })
  expiresAt: Date;
}

/** Someone's payment waiting for an organiser to say it arrived. */
export class PendingDirectPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ description: "A guest's (no account)" })
  guest: boolean;

  @ApiProperty()
  reference: string;

  @ApiProperty()
  amountCents: number;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  ticketType: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ description: "The hold ran out: the place is on offer again, though it can still be confirmed if there's room" })
  expired: boolean;
}

/** How the workspace's buyers pay. Leave a field out to keep it. */
export class UpdatePaymentSettingsDto {
  @ApiPropertyOptional({ enum: ['stripe', 'direct'] })
  @IsOptional()
  @IsIn(['stripe', 'direct'])
  method?: 'stripe' | 'direct';

  @ApiPropertyOptional({ enum: DIRECT_CURRENCIES, description: 'Paying directly: what tickets are priced in' })
  @IsOptional()
  @IsIn(DIRECT_CURRENCIES)
  currency?: string;

  @ApiPropertyOptional({ description: 'Paying directly: how to pay, in your words (eSewa ID, bank account, cash at the door)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 168, description: 'Paying directly: how long a place waits for its payment' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  holdHours?: number;
}
