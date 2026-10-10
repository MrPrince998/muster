import { HttpStatus } from '@nestjs/common';

/**
 * Application error with an HTTP status. Throw it from anywhere (services,
 * guards, controllers); the global exception filter turns it into a response.
 *
 *   throw HttpError.notFound(`User #${id} not found`, 'USER_NOT_FOUND');
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    // machine-readable code the frontend can switch on, e.g. 'USER_NOT_FOUND'
    public readonly code: string = HttpError.defaultCode(statusCode),
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message = 'Bad request', code = 'BAD_REQUEST', details?: unknown) {
    return new HttpError(HttpStatus.BAD_REQUEST, message, code, details);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new HttpError(HttpStatus.UNAUTHORIZED, message, code);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new HttpError(HttpStatus.FORBIDDEN, message, code);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new HttpError(HttpStatus.NOT_FOUND, message, code);
  }

  static conflict(message = 'Conflict', code = 'CONFLICT', details?: unknown) {
    return new HttpError(HttpStatus.CONFLICT, message, code, details);
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_SERVER_ERROR') {
    return new HttpError(HttpStatus.INTERNAL_SERVER_ERROR, message, code);
  }

  // 404 -> 'NOT_FOUND', 422 -> 'UNPROCESSABLE_ENTITY'
  static defaultCode(statusCode: number): string {
    return HttpStatus[statusCode] ?? 'ERROR';
  }
}
