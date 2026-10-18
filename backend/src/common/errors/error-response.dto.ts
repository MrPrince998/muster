import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ErrorResponseBody } from '../filters/all-exceptions.filter.js';

/**
 * The shape of every error response (see AllExceptionsFilter), as a class so
 * Swagger can document it.
 */
export class ErrorResponseDto implements ErrorResponseBody {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({
    description: 'Stable, machine-readable error code to branch on',
    example: 'EMAIL_TAKEN',
  })
  code: string;

  @ApiProperty({ example: 'Email already registered' })
  message: string;

  @ApiPropertyOptional({
    description: 'Extra context, e.g. the list of validation errors',
    example: ['email must be an email'],
  })
  details?: unknown;

  @ApiProperty({ example: '/auth/signup' })
  path: string;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;
}
