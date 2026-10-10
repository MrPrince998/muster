import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { HttpError } from '../errors/http-error.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function mockHost() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl: '/test' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('sends HttpError as-is', () => {
    const { host, status, json } = mockHost();
    filter.catch(HttpError.notFound('User #1 not found', 'USER_NOT_FOUND'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User #1 not found',
        path: '/test',
      }),
    );
  });

  it('maps Nest HttpException', () => {
    const { host, status, json } = mockHost();
    filter.catch(new NotFoundException('Cannot GET /nope'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NOT_FOUND', message: 'Cannot GET /nope' }),
    );
  });

  it('maps validation errors to VALIDATION_ERROR with details', () => {
    const { host, status, json } = mockHost();
    filter.catch(new BadRequestException(['email must be an email']), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: ['email must be an email'],
      }),
    );
  });

  it('maps Postgres unique violation to 409', () => {
    const { host, status, json } = mockHost();
    const err = new QueryFailedError('INSERT ...', [], {
      code: '23505',
      detail: 'Key (email)=(a@b.com) already exists.',
    } as unknown as Error);
    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ALREADY_EXISTS' }));
  });

  it('hides unknown errors behind a 500', () => {
    const { host, status, json } = mockHost();
    vi.spyOn(filter['logger'], 'error').mockImplementation(() => {});
    filter.catch(new Error('db password is hunter2'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }),
    );
  });
});
