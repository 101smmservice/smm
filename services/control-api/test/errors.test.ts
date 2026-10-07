import { DomainError, InvalidStateTransitionError, ValidationError } from '@persona/core';
import {
  ContentNotFoundError,
  ContentValidationError,
  InvalidContentTransitionError,
} from '@persona/publisher';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  API_ERROR_CODES,
  ApiError,
  ManualConfirmationRequiredError,
  mapError,
  NotFoundError,
  RequestValidationError,
} from '../src/index.js';

describe('mapError', () => {
  it('has exactly the documented error codes', () => {
    expect([...API_ERROR_CODES]).toEqual([
      'validation_error',
      'not_found',
      'invalid_transition',
      'manual_confirmation_required',
      'domain_error',
      'internal_error',
    ]);
  });

  it('keeps what an ApiError says', () => {
    expect(mapError(new ApiError(418, 'domain_error', 'teapot', [{ a: 1 }]))).toEqual({
      statusCode: 418,
      body: { error: { code: 'domain_error', message: 'teapot', details: [{ a: 1 }] } },
    });
  });

  it('maps the ApiError subclasses', () => {
    expect(mapError(new RequestValidationError('bad')).statusCode).toBe(400);
    expect(mapError(new NotFoundError('account', 'x')).body.error.code).toBe('not_found');
    expect(mapError(new ManualConfirmationRequiredError('confirm')).statusCode).toBe(409);
  });

  it('maps a ZodError to a validation error that lists the issues', () => {
    const result = z.object({ name: z.string() }).safeParse({});
    if (result.success) {
      throw new Error('parsing should have failed');
    }

    const mapped = mapError(result.error);

    expect(mapped.statusCode).toBe(400);
    expect(mapped.body.error.code).toBe('validation_error');
    expect(mapped.body.error.details).toEqual([
      expect.objectContaining({ path: ['name'], message: expect.any(String) as string }),
    ]);
  });

  it('maps a core ValidationError to 400, naming the field', () => {
    expect(mapError(new ValidationError('must not be empty', 'name'))).toEqual({
      statusCode: 400,
      body: {
        error: {
          code: 'validation_error',
          message: 'must not be empty',
          details: [{ path: ['name'], message: 'must not be empty' }],
        },
      },
    });
    expect(mapError(new ValidationError('bad')).body.error.details).toEqual([
      { path: [], message: 'bad' },
    ]);
  });

  it('maps a forbidden status change to 409 invalid_transition', () => {
    const mapped = mapError(new InvalidStateTransitionError('dead', 'active'));

    expect(mapped.statusCode).toBe(409);
    expect(mapped.body.error.code).toBe('invalid_transition');
    expect(mapped.body.error.details).toEqual([{ from: 'dead', to: 'active' }]);
  });

  it('maps a forbidden content status change to 409 invalid_transition', () => {
    const mapped = mapError(new InvalidContentTransitionError('draft', 'published'));

    expect(mapped.statusCode).toBe(409);
    expect(mapped.body.error.code).toBe('invalid_transition');
    expect(mapped.body.error.details).toEqual([{ from: 'draft', to: 'published' }]);
  });

  it('maps a content item that is not ready to 409 domain_error, with the issues', () => {
    const issues = [{ code: 'missing_brief', message: 'brief must not be empty', field: 'brief' }];

    const mapped = mapError(new ContentValidationError(issues));

    expect(mapped.statusCode).toBe(409);
    expect(mapped.body.error.code).toBe('domain_error');
    expect(mapped.body.error.details).toEqual(issues);
  });

  it('maps an unknown content item to 404', () => {
    const mapped = mapError(new ContentNotFoundError('c1'));

    expect(mapped.statusCode).toBe(404);
    expect(mapped.body.error.code).toBe('not_found');
    expect(mapped.body.error.details).toEqual([{ entity: 'content', id: 'c1' }]);
  });

  it('maps any other domain error to 400 domain_error', () => {
    const mapped = mapError(new DomainError('rule broken'));

    expect(mapped.statusCode).toBe(400);
    expect(mapped.body.error).toEqual({
      code: 'domain_error',
      message: 'rule broken',
      details: [],
    });
  });

  it('passes client errors raised by the framework through as validation errors', () => {
    const mapped = mapError(
      Object.assign(new Error('Unsupported Media Type'), { statusCode: 415 }),
    );

    expect(mapped.statusCode).toBe(415);
    expect(mapped.body.error.code).toBe('validation_error');
    expect(mapped.body.error.message).toBe('Unsupported Media Type');
  });

  it('hides everything about an unexpected error', () => {
    for (const thrown of [
      new Error('secret'),
      Object.assign(new Error('secret'), { statusCode: 503 }),
      'secret',
      null,
      undefined,
      { message: 'secret' },
    ]) {
      const mapped = mapError(thrown);

      expect(mapped).toEqual({
        statusCode: 500,
        body: { error: { code: 'internal_error', message: 'Internal server error', details: [] } },
      });
    }
  });
});
