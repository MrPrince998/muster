import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class FeedbackFormDto {
  @ApiProperty()
  eventTitle: string;

  @ApiProperty()
  clubName: string;

  @ApiProperty()
  endedAt: Date;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Their answer so far, if any' })
  rating: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  comment: string | null;
}

export class GiveFeedbackDto {
  /** Out of five. @example 4 */
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  /** @example 'Great talk; the room was too warm.' */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class FeedbackCommentDto {
  @ApiProperty()
  rating: number;

  @ApiProperty()
  comment: string;

  @ApiProperty()
  at: Date;
}

/** What people thought, without names. */
export class FeedbackSummaryDto {
  @ApiProperty({ description: 'How many answered' })
  count: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Average rating, one decimal; null with no answers' })
  average: number | null;

  @ApiProperty({ type: [Number], description: 'How many gave 1, 2, 3, 4 and 5' })
  ratings: number[];

  @ApiProperty({ description: 'How many were asked (everyone who came)' })
  asked: number;

  @ApiProperty({ type: [FeedbackCommentDto], description: 'Comments, newest first' })
  comments: FeedbackCommentDto[];
}
