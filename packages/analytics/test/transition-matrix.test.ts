import type { LifecycleEvent, LifecycleEventType } from '@persona/core';
import { describe, expect, it } from 'vitest';

import { buildTransitionMatrix } from '../src/index.js';

let counter = 0;

function makeEvent(
  type: LifecycleEventType,
  payload: Record<string, unknown> = {},
  overrides: Partial<LifecycleEvent> = {},
): LifecycleEvent {
  counter += 1;
  return {
    id: `evt_${String(counter)}`,
    accountId: 'acc_1',
    type,
    payload,
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function change(from: unknown, to: unknown): LifecycleEvent {
  return makeEvent('state_changed', { from, to });
}

describe('buildTransitionMatrix', () => {
  it('returns an empty array when there are no events', () => {
    expect(buildTransitionMatrix([])).toEqual([]);
  });

  it('counts state_changed events per from -> to pair', () => {
    expect(buildTransitionMatrix([change('connected', 'onboarding')])).toEqual([
      { from: 'connected', to: 'onboarding', count: 1 },
    ]);
  });

  it('ignores events of other types, even with a from/to payload', () => {
    const events = [
      makeEvent('action_performed', { from: 'connected', to: 'onboarding' }),
      makeEvent('restriction_detected', { from: 'active', to: 'limited' }),
      makeEvent('error'),
      change('warming', 'active'),
    ];

    expect(buildTransitionMatrix(events)).toEqual([{ from: 'warming', to: 'active', count: 1 }]);
  });

  it('ignores events without payload.from or payload.to', () => {
    const events = [
      makeEvent('state_changed'),
      makeEvent('state_changed', { from: 'active' }),
      makeEvent('state_changed', { to: 'limited' }),
      change('active', 'limited'),
    ];

    expect(buildTransitionMatrix(events)).toEqual([{ from: 'active', to: 'limited', count: 1 }]);
  });

  it('ignores invalid statuses and non-string values', () => {
    const events = [
      change('active', 'banned'),
      change('banned', 'dead'),
      change(1, 2),
      change(null, 'dead'),
      change('active', undefined),
      change({ status: 'active' }, 'dead'),
      change('review', 'dead'),
    ];

    expect(buildTransitionMatrix(events)).toEqual([{ from: 'review', to: 'dead', count: 1 }]);
  });

  it('sums repeated transitions', () => {
    const events = [
      change('warming', 'active'),
      change('active', 'limited'),
      change('warming', 'active'),
      change('warming', 'active'),
    ];

    expect(buildTransitionMatrix(events)).toEqual([
      { from: 'active', to: 'limited', count: 1 },
      { from: 'warming', to: 'active', count: 3 },
    ]);
  });

  it('keeps opposite directions apart', () => {
    const events = [change('review', 'warming'), change('warming', 'review')];

    expect(buildTransitionMatrix(events)).toHaveLength(2);
  });

  it('sorts by from, then by to', () => {
    const events = [
      change('warming', 'limited'),
      change('review', 'warming'),
      change('active', 'limited'),
      change('review', 'dead'),
      change('connected', 'onboarding'),
      change('warming', 'active'),
    ];

    expect(buildTransitionMatrix(events).map(({ from, to }) => `${from}>${to}`)).toEqual([
      'active>limited',
      'connected>onboarding',
      'review>dead',
      'review>warming',
      'warming>active',
      'warming>limited',
    ]);
  });

  it('does not mutate the input', () => {
    const events = [change('warming', 'active'), change('active', 'limited')];
    const snapshot = structuredClone(events);
    Object.freeze(events);

    buildTransitionMatrix(events);

    expect(events).toEqual(snapshot);
  });
});
