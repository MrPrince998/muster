import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { HttpError } from '../errors/http-error.js';

export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
}

// Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_NOT_NULL_VIOLATION = '23502';
const PG_CHECK_VIOLATION = '23514';
const PG_INVALID_TEXT_REPRESENTATION = '22P02';

/**
 * Central error handler: every error thrown during a request ends up here and
 * is sent back in the same ErrorResponseBody shape.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const error = this.toHttpError(exception);

    if (error.statusCode >= 500) {
      // log the original error, never send its internals to the client
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${error.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details !== undefined && { details: error.details }),
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    };

    response.status(error.statusCode).json(body);
  }

  private toHttpError(exception: unknown): HttpError {
    if (exception instanceof HttpError) {
      return exception;
    }

    // the body parser's own refusals (a body too large, malformed JSON): http-errors with a 4xx
    // status meant for the client ("expose"); anything else stays a 500
    if (exception instanceof Error && 'expose' in exception && exception.expose === true && 'status' in exception) {
      const status = Number(exception.status);
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        return new HttpError(status, 'That is too large to send', 'PAYLOAD_TOO_LARGE');
      }
      if (status >= 400 && status < 500) return new HttpError(status, exception.message);
    }

    // Nest's built-in exceptions (NotFoundException, ValidationPipe errors, unknown routes, ...)
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null && 'message' in res) {
        const { message } = res as { message: string | string[] };
        // ValidationPipe returns an array of messages
        return Array.isArray(message)
          ? new HttpError(statusCode, 'Validation failed', 'VALIDATION_ERROR', message)
          : new HttpError(statusCode, message);
      }
      return new HttpError(statusCode, exception.message);
    }

    if (exception instanceof QueryFailedError) {
      const { code, detail } = exception.driverError as { code?: string; detail?: string };
      switch (code) {
        case PG_UNIQUE_VIOLATION:
          return HttpError.conflict('Resource already exists', 'ALREADY_EXISTS', detail);
        case PG_FOREIGN_KEY_VIOLATION:
          return HttpError.conflict('Related resource conflict', 'FOREIGN_KEY_VIOLATION', detail);
        case PG_NOT_NULL_VIOLATION:
        case PG_CHECK_VIOLATION:
        case PG_INVALID_TEXT_REPRESENTATION:
          return HttpError.badRequest('Invalid input', 'INVALID_INPUT');
      }
    }

    return new HttpError(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
  }
}
