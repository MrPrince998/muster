import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { HttpError } from '../../common/errors/http-error.js';
import type { AuthUser } from '../../common/types/auth-user.js';
import { BEARER_AUTH } from '../../swagger.js';
import { DeleteAccountDto, UpdateUserDto } from './dto/update-user.dto.js';
import { User } from './entities/user.entity.js';
import { UserService } from './user.service.js';

const error = (description: string) => ({ description, type: ErrorResponseDto });

/**
 * Your own account, and only yours: any other id answers 404, exactly like
 * an id nobody has, so the routes can't be used to find out who exists.
 * Accounts are created by /auth/signup; there is no user listing.
 */
@ApiTags('users')
@ApiBearerAuth(BEARER_AUTH)
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':id')
  @ApiOkResponse({ type: User })
  @ApiNotFoundResponse(error('Not your account (USER_NOT_FOUND)'))
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.userService.findOne(ownId(user, id));
  }

  @Patch(':id')
  @ApiOkResponse({ type: User })
  @ApiNotFoundResponse(error('Not your account (USER_NOT_FOUND)'))
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<User> {
    return this.userService.update(ownId(user, id), { name: dto.name.trim() });
  }

  @Delete(':id')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Account deleted; every session ends with it' })
  @ApiNotFoundResponse(error('Not your account (USER_NOT_FOUND)'))
  @ApiForbiddenResponse(error('Wrong password (INVALID_PASSWORD)'))
  @ApiConflictResponse(error('Still owns a workspace (OWNS_WORKSPACE)'))
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { password }: DeleteAccountDto,
  ): Promise<void> {
    return this.userService.removeAccount(ownId(user, id), password);
  }
}

/** The id, if it's the signed-in user's own; otherwise the same 404 as an unknown id. */
function ownId(user: AuthUser, id: string): string {
  if (id !== user.id) throw HttpError.notFound(`User #${id} not found`, 'USER_NOT_FOUND');
  return id;
}
