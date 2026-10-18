import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttendanceSummaryDto {
  @ApiProperty({ description: 'Published events that have ended (cancelled ones excluded)' }) eventsHeld: number;
  @ApiProperty({ description: 'Published events still to come' }) upcomingEvents: number;
  @ApiProperty({ description: 'Places taken at the events held' }) registered: number;
  @ApiProperty({ description: 'People checked in at the events held' }) attended: number;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'attended / registered, 0 to 1; null before any' })
  attendanceRate: number | null;
  @ApiProperty({ description: 'Places at the events held taken by people outside the workspace (public events)' })
  guests: number;
}

export class AttendanceMonthDto {
  @ApiProperty({ example: '2026-10', description: 'In the app time zone (APP_TIME_ZONE)' }) month: string;
  @ApiProperty({ description: 'Events held that month' }) events: number;
  @ApiProperty() registered: number;
  @ApiProperty() attended: number;
}

export class AttendanceEventDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty() startsAt: Date;
  @ApiProperty({ enum: ['published', 'cancelled'] }) status: 'published' | 'cancelled';
  @ApiProperty() ended: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) capacity: number | null;
  @ApiProperty() registered: number;
  @ApiProperty() attended: number;
  @ApiProperty({ description: 'From outside the workspace' }) guests: number;
}

/** A club's attendance: the overall picture, by month, and per event. */
export class ClubAttendanceDto {
  @ApiProperty({ type: AttendanceSummaryDto }) summary: AttendanceSummaryDto;
  @ApiProperty({ type: [AttendanceMonthDto], description: 'The last 12 months, oldest first, empty months included' })
  months: AttendanceMonthDto[];
  @ApiProperty({ type: [AttendanceEventDto], description: 'Up to 50 events, latest first (drafts never)' })
  events: AttendanceEventDto[];
}
