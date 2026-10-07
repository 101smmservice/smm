import { randomUUID } from 'node:crypto';

import { ValidationError } from '../errors/domain-errors.js';

export const LIFECYCLE_EVENT_TYPES = [
  'state_changed',
  'action_performed',
  'action_failed',
  'restriction_detected',
  'session_started',
  'session_ended',
  'error',
] as const;

export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

export function isLifecycleEventType(value: unknown): value is LifecycleEventType {
  return typeof value === 'string' && (LIFECYCLE_EVENT_TYPES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface LifecycleEvent {
  id: string;
  accountId: string;
  type: LifecycleEventType;
  payload: Record<string, unknown>;
  /** ISO 8601 */
  createdAt: string;
}

export interface CreateLifecycleEventInput {
  accountId: string;
  type: LifecycleEventType;
  payload?: Record<string, unknown>;
  createdAt?: Date;
}

export function createLifecycleEvent(input: CreateLifecycleEventInput): LifecycleEvent {
  const { accountId, type, payload = {}, createdAt = new Date() } = input;

  if (typeof accountId !== 'string' || accountId.trim() === '') {
    throw new ValidationError('accountId must be a non-empty string', 'accountId');
  }
  if (!isLifecycleEventType(type)) {
    throw new ValidationError(`unknown lifecycle event type: ${String(type)}`, 'type');
  }
  if (!isPlainObject(payload)) {
    throw new ValidationError('payload must be a plain object', 'payload');
  }
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
    throw new ValidationError('createdAt must be a valid Date', 'createdAt');
  }

  return {
    id: randomUUID(),
    accountId,
    type,
    payload: { ...payload },
    createdAt: createdAt.toISOString(),
  };
}
