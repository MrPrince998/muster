import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { BEARER_AUTH } from '../../swagger.js';
import { SearchQuery, SearchResultDto } from './dto/search.dto.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@ApiBearerAuth(BEARER_AUTH)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * Search your workspaces
   *
   * @remarks Workspaces, clubs and events you can open, and the members of
   * your workspaces. Partial words and small typos match.
   */
  @Get()
  @ApiOkResponse({ type: SearchResultDto })
  @ApiBadRequestResponse({ description: 'q shorter than 2 characters (VALIDATION_ERROR)', type: ErrorResponseDto })
  search(@CurrentUser() user: AuthUser, @Query() { q }: SearchQuery): Promise<SearchResultDto> {
    return this.searchService.search(user, q);
  }
}
