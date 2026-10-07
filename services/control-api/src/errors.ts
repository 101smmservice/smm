import {
  DuplicateIntakeError,
  IntakeNotFoundError,
  IntakeValidationError,
  InvalidIntakeTransitionError,
} from '@persona/account-intake';
import { DomainError, InvalidStateTransitionError, ValidationError } from '@persona/core';
import {
  ContentNotFoundError,
  ContentValidationError,
  InvalidContentTransitionError,
} from '@persona/publisher';
import { SimulatorAlreadyRunningError, SimulatorNotRunningError } from '@persona/simulator';
import { ZodError } from 'zod';

export const API_ERROR_CODES = [
  'validation_error',
  'not_found',
  'invalid_transition',
  'manual_confirmation_required',
  'duplicate_intake',
  'simulator_already_running',
  'simulator_not_running',
  'domain_error',
  'internal_error',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The single shape every error response has. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details: unknown[];
  };
}

export interface MappedError {
  statusCode: number;
  body: ApiErrorBody;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: unknown[];

  constructor(statusCode: number, code: ApiErrorCode, message: string, details: unknown[] = []) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class RequestValidationError extends ApiError {
  constructor(message: string, details: unknown[] = []) {
    super(400, 'validation_error', message, details);
    this.name = 'RequestValidationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(entity: string, id: string) {
    super(404, 'not_found', `${entity} not found: ${id}`, [{ entity, id }]);
    this.name = 'NotFoundError';
  }
}

export class ManualConfirmationRequiredError extends ApiError {
  constructor(message: string, details: unknown[] = []) {
    super(409, 'manual_confirmation_required', message, details);
    this.name = 'ManualConfirmationRequiredError';
  }
}

/**
 * Turns anything thrown while handling a request into the status code and body of the response.
 * Stack traces and unexpected messages never reach the client.
 */
export function mapError(error: unknown): MappedError {
  if (error instanceof ApiError) {
    return mapped(error.statusCode, error.code, error.message, error.details);
  }
  if (error instanceof ZodError) {
    return mapped(400, 'validation_error', 'Request validation failed', describeZodIssues(error));
  }
  if (error instanceof InvalidStateTransitionError) {
    return mapped(409, 'invalid_transition', error.message, [{ from: error.from, to: error.to }]);
  }
  if (error instanceof InvalidContentTransitionError) {
    return mapped(409, 'invalid_transition', error.message, [{ from: error.from, to: error.to }]);
  }
  if (error instanceof ContentNotFoundError) {
    return mapped(404, 'not_found', error.message, [{ entity: 'content', id: error.contentId }]);
  }
  if (error instanceof ContentValidationError) {
    return mapped(409, 'domain_error', error.message, [...error.issues]);
  }
  if (error instanceof IntakeNotFoundError) {
    return mapped(404, 'not_found', error.message, [
      { entity: 'intake_request', id: error.requestId },
    ]);
  }
  if (error instanceof InvalidIntakeTransitionError) {
    return mapped(409, 'invalid_transition', error.message, [{ from: error.from, to: error.to }]);
  }
  if (error instanceof IntakeValidationError) {
    return mapped(400, 'validation_error', error.message, [
      { path: error.field === undefined ? [] : [error.field], message: error.message },
    ]);
  }
  if (error instanceof DuplicateIntakeError) {
    return mapped(409, 'duplicate_intake', error.message, [
      {
        platform: error.platform,
        externalAccountId: error.externalAccountId,
        existingRequestId: error.existingRequestId,
      },
    ]);
  }
  if (error instanceof SimulatorAlreadyRunningError) {
    return mapped(409, 'simulator_already_running', error.message);
  }
  if (error instanceof SimulatorNotRunningError) {
    return mapped(409, 'simulator_not_running', error.message);
  }
  if (error instanceof ValidationError) {
    return mapped(400, 'validation_error', error.message, [
      { path: error.field === undefined ? [] : [error.field], message: error.message },
    ]);
  }
  if (error instanceof DomainError) {
    return mapped(400, 'domain_error', error.message);
  }

  const clientStatus = clientErrorStatus(error);
  if (clientStatus !== null) {
    // Errors raised by Fastify itself, e.g. a body that is not valid JSON.
    const message = error instanceof Error ? error.message : 'Bad request';
    return mapped(clientStatus, clientStatus === 404 ? 'not_found' : 'validation_error', message);
  }

  return mapped(500, 'internal_error', 'Internal server error');
}

function mapped(
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details: unknown[] = [],
): MappedError {
  return { statusCode, body: { error: { code, message, details } } };
}

function describeZodIssues(error: ZodError): unknown[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
    code: issue.code,
  }));
}

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return null;
  }
  const { statusCode } = error;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : null;
}
