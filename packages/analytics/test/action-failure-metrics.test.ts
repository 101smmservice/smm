import type { LifecycleEvent, LifecycleEventType } from '@persona/core';
import { describe, expect, it } from 'vitest';

import { calculateActionFailureMetrics } from '../src/index.js';

let counter = 0;

function makeEvent(type: LifecycleEventType, createdAt: string): LifecycleEvent {
  counter += 1;
  return { id: `evt_${String(counter)}`, accountId: 'acc_1', type, payload: {}, createdAt };
}

const performed = (createdAt: string) => makeEvent('action_performed', createdAt);
const failed = (createdAt: string) => makeEvent('action_failed', createdAt);

describe('calculateActionFailureMetrics', () => {
  it('returns an empty array when there are no events', () => {
    expect(calculateActionFailureMetrics([])).toEqual([]);
  });

  it('counts performed and failed actions per day', () => {
    const events = [
      performed('2026-07-01T10:00:00.000Z'),
      performed('2026-07-01T11:00:00.000Z'),
      performed('2026-07-01T12:00:00.000Z'),
      failed('2026-07-01T13:00:00.000Z'),
    ];

    expect(calculateActionFailureMetrics(events)).toEqual([
      { date: '2026-07-01', performed: 3, failed: 1, failureRate: 0.25 },
    ]);
  });

  it('ignores events of other types', () => {
    const events = [
      makeEvent('state_changed', '2026-07-01T10:00:00.000Z'),
      makeEvent('restriction_detected', '2026-07-01T10:00:00.000Z'),
      makeEvent('session_started', '2026-07-01T10:00:00.000Z'),
      makeEvent('session_ended', '2026-07-01T10:00:00.000Z'),
      makeEvent('error', '2026-07-01T10:00:00.000Z'),
      performed('2026-07-01T11:00:00.000Z'),
    ];

    expect(calculateActionFailureMetrics(events)).toEqual([
      { date: '2026-07-01', performed: 1, failed: 0, failureRate: 0 },
    ]);
  });

  it('calculates failed / (performed + failed)', () => {
    const events = [
      failed('2026-07-01T10:00:00.000Z'),
      failed('2026-07-01T10:01:00.000Z'),
      performed('2026-07-01T10:02:00.000Z'),
      failed('2026-07-02T10:00:00.000Z'),
      performed('2026-07-03T10:00:00.000Z'),
    ];

    const rates = calculateActionFailureMetrics(events).map((row) => row.failureRate);

    expect(rates[0]).toBeCloseTo(2 / 3, 10);
    expect(rates[1]).toBe(1);
    expect(rates[2]).toBe(0);
  });

  it('applies the date range inclusively', () => {
    const events = [
      performed('2026-06-30T23:59:59.999Z'),
      performed('2026-07-01T00:00:00.000Z'),
      failed('2026-07-02T10:00:00.000Z'),
      performed('2026-07-03T23:59:59.999Z'),
      failed('2026-07-04T00:00:00.000Z'),
    ];

    const result = calculateActionFailureMetrics(events, {
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    });

    expect(result.map((row) => row.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });

  it('creates no rows for days without actions', () => {
    const events = [performed('2026-07-01T10:00:00.000Z'), failed('2026-07-04T10:00:00.000Z')];

    expect(calculateActionFailureMetrics(events).map((row) => row.date)).toEqual([
      '2026-07-01',
      '2026-07-04',
    ]);
  });

  it('never produces a row with a NaN failure rate', () => {
    const events = [
      makeEvent('error', '2026-07-01T10:00:00.000Z'),
      makeEvent('session_started', '2026-07-02T10:00:00.000Z'),
    ];

    expect(calculateActionFailureMetrics(events)).toEqual([]);
  });

  it('sorts the result by date', () => {
    const events = [
      performed('2026-07-03T10:00:00.000Z'),
      failed('2026-07-01T10:00:00.000Z'),
      performed('2026-07-02T10:00:00.000Z'),
    ];

    expect(calculateActionFailureMetrics(events).map((row) => row.date)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
  });

  it('does not mutate the input', () => {
    const events = [performed('2026-07-02T10:00:00.000Z'), failed('2026-07-01T10:00:00.000Z')];
    const snapshot = structuredClone(events);
    Object.freeze(events);

    calculateActionFailureMetrics(events);

    expect(events).toEqual(snapshot);
  });
});
