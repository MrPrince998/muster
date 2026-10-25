import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  ArrayMaxSize,
  IsArray,
  IsUUID,
  Matches,
  IsNotEmpty,
  IsObject,
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

/** A page of past events: ?before= continues from the page before. */
export class PastEventsQuery {
  /** The `next` of the page before */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
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

export class QuestionInputDto {
  /** Keep a question's id when editing it, so its answers stay with it; leave out for a new one */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  id?: string;

  /** @example 'Dietary needs' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  label: string;

  @ApiProperty({ enum: ['text', 'choice'] })
  @IsIn(['text', 'choice'])
  kind: 'text' | 'choice';

  /** For a choice question: 2 to 10 choices. @example ['None', 'Vegetarian', 'Vegan'] */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class QuestionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  label: string;

  @ApiProperty({ enum: ['text', 'choice'] })
  kind: 'text' | 'choice';

  @ApiProperty({ type: [String] })
  options: string[];

  @ApiProperty()
  required: boolean;
}

/** Answers to an event's questions, by question id. */
export class AnswersDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { k3Rn8: 'Vegan' } })
  @IsOptional()
  @IsObject()
  answers?: Record<string, string>;
}

export class TicketTypeInputDto {
  /** Keep a type's id when editing it, so its sales stay with it; leave out for a new one */
  @IsOptional()
  @IsUUID()
  id?: string;

  /** @example 'Members' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  /** In the currency's smallest unit; 0 for free. @example 1000 */
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priceCents: number;

  /** At most this many of this type; null or left out: only the event's capacity */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity?: number | null;

  /** Only for the club's members: not offered on the public page */
  @IsOptional()
  @IsBoolean()
  membersOnly?: boolean;

  /** On sale until then (early bird); null or left out: until the event */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsDateString({ strict: true })
  salesEndAt?: string | null;
}

export class TicketTypeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: '0: free' })
  priceCents: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  capacity: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Left of this type; null: no limit of its own' })
  remaining: number | null;

  @ApiProperty()
  membersOnly: boolean;

  @ApiPropertyOptional({ type: Date, nullable: true })
  salesEndAt: Date | null;

  @ApiProperty({ description: "On sale now: before its end, and some left" })
  onSale: boolean;
}

/** Getting a ticket: which one, a discount code, and the answers to the event's questions. */
export class GetTicketDto extends AnswersDto {
  /** Needed when more than one ticket is on offer */
  @IsOptional()
  @IsUUID()
  ticketTypeId?: string;

  /** @example 'EARLYBIRD' */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;
}

export class CreateDiscountCodeDto {
  /** Letters, digits, dashes; matched ignoring case. @example 'EARLYBIRD' */
  @IsString()
  @Matches(/^[A-Za-z0-9-]{3,30}$/, { message: 'code is 3 to 30 letters, digits or dashes' })
  code: string;

  /** A percentage off (1 to 100); give this or amountOffCents */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  percentOff?: number;

  /** An amount off, in the currency's smallest unit */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amountOffCents?: number;

  /** At most this many uses; left out: no limit */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxUses?: number;

  /** Works until then; left out: until the event */
  @IsOptional()
  @IsDateString({ strict: true })
  expiresAt?: string;
}

export class DiscountCodeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  percentOff: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  amountOffCents: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  maxUses: number | null;

  @ApiProperty({ description: 'Places taken with it (and checkouts open)' })
  uses: number;

  @ApiPropertyOptional({ type: Date, nullable: true })
  expiresAt: Date | null;

  @ApiProperty()
  active: boolean;
}

export class UpdateDiscountCodeDto {
  /** false turns it off (people who used it keep their tickets) */
  @IsBoolean()
  active: boolean;
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
   * A shorthand for one ticket type, "General admission", at this price (in
   * the currency's smallest unit: 1500 is $15.00); null or left out with no
   * ticketTypes: free. Paid tickets need the workspace's Stripe account
   * ready; the currency is the account's. @example 1500
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(50)
  @Max(1_000_000)
  priceCents?: number | null;

  /** A paid place given back at least this many hours before the start is refunded. @example 48 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  refundCutoffHours?: number;

  /** The ways in: up to ten ticket types (prices, limits, members-only, early bird). Replaces priceCents. */
  @ApiPropertyOptional({ type: [TicketTypeInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TicketTypeInputDto)
  ticketTypes?: TicketTypeInputDto[];

  /** What to ask people taking a place: up to five questions */
  @ApiPropertyOptional({ type: [QuestionInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => QuestionInputDto)
  questions?: QuestionInputDto[];

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

/** A paid event's ticket price. */
export class PriceDto {
  @ApiProperty({ description: "In the currency's smallest unit (cents)", example: 1500 })
  amountCents: number;

  @ApiProperty({ description: 'ISO 4217, lowercase', example: 'aud' })
  currency: string;
}

export class YourPaymentDto {
  @ApiProperty()
  amountCents: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ description: 'Giving the place back now refunds it' })
  refundable: boolean;
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

  @ApiPropertyOptional({ type: PriceDto, nullable: true, description: 'The cheapest paid ticket ("from"); null: all free' })
  price: PriceDto | null;

  @ApiProperty({ type: [TicketTypeDto], description: 'The ways in; none: free for everyone' })
  ticketTypes: TicketTypeDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Which ticket you have' })
  yourTicketType: string | null;

  @ApiProperty({ description: 'A paid place given back at least this many hours before the start is refunded' })
  refundCutoffHours: number;

  @ApiProperty({ description: 'Places held by people paying for them right now' })
  heldCount: number;

  @ApiPropertyOptional({ type: YourPaymentDto, nullable: true, description: 'What you paid for your place, if anything' })
  yourPayment: YourPaymentDto | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Takings, less refunds (only for people who can edit it)' })
  salesCents: number | null;

  @ApiProperty({ type: [QuestionDto], description: 'What people taking a place are asked' })
  questions: QuestionDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: "Its cover image, a path on the API (/files/...)" })
  coverUrl: string | null;
}

export class SendEventMessageDto {
  /** @example 'Room change' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  subject: string;

  /** A blank line starts a new paragraph. @example 'We have moved to Hall C, next door.' */
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body: string;

  /** Send it to the waitlist too */
  @IsOptional()
  @IsBoolean()
  toWaitlist?: boolean;
}

export class EventMessageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ description: "Who sent it (today's name)" })
  senderName: string;

  @ApiProperty()
  toWaitlist: boolean;

  @ApiProperty({ description: 'How many it went to' })
  recipientCount: number;

  @ApiProperty()
  sentAt: Date;
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

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: "Their answers, by question id" })
  answers: Record<string, string>;
}

/** A page of who's going: ?after= continues. */
export class AttendeesQuery {
  /** The `next` of the page before */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  after?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** How everyone going answered one question: the count per choice, or how many answered a text one. */
export class AnswerTallyDto {
  @ApiProperty()
  questionId: string;

  @ApiProperty({ description: 'How many going gave an answer' })
  answered: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'For a choice question: how many chose each option (empty for a text one)',
  })
  options: Record<string, number>;
}

export class AttendeesPageDto {
  @ApiProperty({ type: [EventAttendeeDto] })
  attendees: EventAttendeeDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Pass as `after` for the next page; null at the end' })
  next: string | null;

  @ApiProperty({ description: "How many are going (or registered, once it's over)" })
  total: number;

  @ApiProperty({ type: [AnswerTallyDto], description: "Every question's tally, over everyone going (not just this page)" })
  tallies: AnswerTallyDto[];
}

export class MyRegistrationDto {
  @ApiProperty({ format: 'uuid', description: 'The ticket id' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  eventId: string;

  @ApiProperty()
  registeredAt: Date;
}

export class PastEventsPageDto {
  @ApiProperty({ type: [EventDto] })
  events: EventDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Pass as `before` for the next page; null at the end' })
  next: string | null;

  @ApiProperty({ description: 'How many past events the club has' })
  total: number;
}
