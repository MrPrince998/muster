import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ClubAccess } from '../permission/club-access.js';
import { CurrentClubAccess } from '../permission/decorators/current-club-access.decorator.js';
import { RequirePermission } from '../permission/decorators/require-permission.decorator.js';
import { Permission } from '../permission/permissions.js';
import { AnalyticsService } from './analytics.service.js';
import { ClubAttendanceDto } from './dto/analytics.dto.js';

@ApiTags('analytics')
@Controller('clubs/:clubId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * A club's attendance
   *
   * @remarks Needs analytics.view. Events held, places taken and used, the
   * last 12 months, and per event. Computed live; nothing is stored.
   */
  @Get()
  @RequirePermission(Permission.AnalyticsView)
  @ApiOkResponse({ type: ClubAttendanceDto })
  attendance(@CurrentClubAccess() access: ClubAccess): Promise<ClubAttendanceDto> {
    return this.analytics.attendance(access);
  }
}
