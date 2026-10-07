import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLifecycleEvent,
  DomainError,
  InvalidStateTransitionError,
  LIFECYCLE_EVENT_TYPES,
  ValidationError,
  type LifecycleEventType,
} from '../src/index.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('createLifecycleEvent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an event with id, accountId, type, payload and createdAt', () => {
    const createdAt = new Date('2025-03-01T12:30:00.000Z');

    const event = createLifecycleEvent({
      accountId: 'acc-1',
      type: 'state_changed',
      payload: { from: 'connected', to: 'onboarding' },
      createdAt,
    });

    expect(event.id).toMatch(UUID_PATTERN);
    expect(event.accountId).toBe('acc-1');
    expect(event.type).toBe('state_changed');
    expect(event.payload).toEqual({ from: 'connected', to: 'onboarding' });
    expect(event.createdAt).toBe('2025-03-01T12:30:00.000Z');
  });

  it('defaults payload to an empty object', () => {
    const event = createLifecycleEvent({ accountId: 'acc-1', type: 'session_started' });

    expect(event.payload).toEqual({});
  });

  it('defaults createdAt to the current time as an ISO string', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-04-05T06:07:08.009Z'));

    const event = createLifecycleEvent({ accountId: 'acc-1', type: 'session_ended' });

    expect(event.createdAt).toBe('2025-04-05T06:07:08.009Z');
  });

  it('generates a unique id for every event', () => {
    const first = createLifecycleEvent({ accountId: 'acc-1', type: 'error' });
    const second = createLifecycleEvent({ accountId: 'acc-1', type: 'error' });

    expect(first.id).not.toBe(second.id);
  });

  it('does not keep a reference to the input payload', () => {
    const payload = { reason: 'initial' };

    const event = createLifecycleEvent({ accountId: 'acc-1', type: 'action_failed', payload });
    payload.reason = 'changed';

    expect(event.payload).toEqual({ reason: 'initial' });
  });

  it.each(LIFECYCLE_EVENT_TYPES)('accepts event type %s', (type) => {
    expect(createLifecycleEvent({ accountId: 'acc-1', type }).type).toBe(type);
  });

  describe('validation', () => {
    it.each(['', '   '])('rejects blank accountId %j', (accountId) => {
      expect(() => createLifecycleEvent({ accountId, type: 'error' })).toThrow(ValidationError);
    });

    it('rejects an unknown event type', () => {
      const type = 'unknown' as unknown as LifecycleEventType;

      expect(() => createLifecycleEvent({ accountId: 'acc-1', type })).toThrow(ValidationError);
    });

    it.each([null, [], 'text', 42])('rejects non-object payload %j', (payload) => {
      const invalid = payload as unknown as Record<string, unknown>;

      expect(() =>
        createLifecycleEvent({ accountId: 'acc-1', type: 'error', payload: invalid }),
      ).toThrow(ValidationError);
    });

    it('rejects an invalid createdAt date', () => {
      expect(() =>
        createLifecycleEvent({
          accountId: 'acc-1',
          type: 'error',
          createdAt: new Date('not a date'),
        }),
      ).toThrow(ValidationError);
    });

    it('reports the offending field', () => {
      try {
        createLifecycleEvent({ accountId: '', type: 'error' });
        expect.unreachable('createLifecycleEvent should have thrown');
      } catch (error) {
        expect((error as ValidationError).field).toBe('accountId');
      }
    });
  });
});

describe('domain errors', () => {
  it('derive from DomainError and Error', () => {
    const validation = new ValidationError('bad input', 'field');
    const transition = new InvalidStateTransitionError('dead', 'active');

    expect(validation).toBeInstanceOf(DomainError);
    expect(validation).toBeInstanceOf(Error);
    expect(validation.name).toBe('ValidationError');
    expect(validation.code).toBe('VALIDATION_ERROR');

    expect(transition).toBeInstanceOf(DomainError);
    expect(transition.name).toBe('InvalidStateTransitionError');
  });
});
