import { ValidationError, type LifecycleEvent, type LifecycleEventType } from '@persona/core';
import { describe, expect, it } from 'vitest';

import { calculateRestrictionFrequency } from '../src/index.js';

let counter = 0;

function makeEvent(
  type: LifecycleEventType,
  createdAt: string,
  accountId = 'acc_1',
): LifecycleEvent {
  counter += 1;
  return { id: `evt_${String(counter)}`, accountId, type, payload: {}, createdAt };
}

const restriction = (createdAt: string, accountId?: string) =>
  makeEvent('restriction_detected', createdAt, accountId);

describe('calculateRestrictionFrequency', () => {
  it('returns an empty array when there are no events', () => {
    expect(calculateRestrictionFrequency([])).toEqual([]);
  });

  it('counts only restriction_detected events', () => {
    const events = [
      makeEvent('action_failed', '2026-07-01T10:00:00.000Z'),
      makeEvent('state_changed', '2026-07-01T11:00:00.000Z'),
      makeEvent('error', '2026-07-01T12:00:00.000Z'),
      restriction('2026-07-01T13:00:00.000Z'),
    ];

    expect(calculateRestrictionFrequency(events)).toEqual([
      { date: '2026-07-01', restrictionEvents: 1, accountsAffected: 1 },
    ]);
  });

  it('returns no rows when there are only events of other types', () => {
    expect(
      calculateRestrictionFrequency([makeEvent('action_failed', '2026-07-01T10:00:00.000Z')]),
    ).toEqual([]);
  });

  it('groups events by the date of createdAt', () => {
    const events = [
      restriction('2026-07-01T01:00:00.000Z'),
      restriction('2026-07-01T23:59:59.999Z'),
      restriction('2026-07-02T00:00:00.000Z'),
    ];

    expect(calculateRestrictionFrequency(events)).toEqual([
      { date: '2026-07-01', restrictionEvents: 2, accountsAffected: 1 },
      { date: '2026-07-02', restrictionEvents: 1, accountsAffected: 1 },
    ]);
  });

  it('counts every event but each affected account only once per day', () => {
    const events = [
      restriction('2026-07-01T01:00:00.000Z', 'acc_1'),
      restriction('2026-07-01T02:00:00.000Z', 'acc_1'),
      restriction('2026-07-01T03:00:00.000Z', 'acc_2'),
      restriction('2026-07-02T03:00:00.000Z', 'acc_1'),
    ];

    expect(calculateRestrictionFrequency(events)).toEqual([
      { date: '2026-07-01', restrictionEvents: 3, accountsAffected: 2 },
      { date: '2026-07-02', restrictionEvents: 1, accountsAffected: 1 },
    ]);
  });

  it('assigns a timestamp with an offset to its UTC date', () => {
    const events = [restriction('2026-07-01T23:30:00-05:00')];

    expect(calculateRestrictionFrequency(events)).toEqual([
      { date: '2026-07-02', restrictionEvents: 1, accountsAffected: 1 },
    ]);
  });

  it('applies the date range inclusively', () => {
    const events = [
      restriction('2026-06-30T23:59:59.999Z'),
      restriction('2026-07-01T00:00:00.000Z'),
      restriction('2026-07-02T12:00:00.000Z'),
      restriction('2026-07-03T23:59:59.999Z'),
      restriction('2026-07-04T00:00:00.000Z'),
    ];

    const result = calculateRestrictionFrequency(events, {
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    });

    expect(result.map((row) => row.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });

  it('returns an empty array when nothing falls into the range', () => {
    const result = calculateRestrictionFrequency([restriction('2026-07-01T10:00:00.000Z')], {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });

    expect(result).toEqual([]);
  });

  it('sorts the result by date', () => {
    const events = [
      restriction('2026-07-03T10:00:00.000Z'),
      restriction('2026-07-01T10:00:00.000Z'),
      restriction('2026-07-02T10:00:00.000Z'),
    ];

    expect(calculateRestrictionFrequency(events).map((row) => row.date)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
  });

  it('does not mutate the input', () => {
    const events = [
      restriction('2026-07-02T10:00:00.000Z'),
      restriction('2026-07-01T10:00:00.000Z'),
    ];
    const snapshot = structuredClone(events);
    Object.freeze(events);

    calculateRestrictionFrequency(events);

    expect(events).toEqual(snapshot);
  });

  describe('validation', () => {
    it.each([
      { startDate: '2026-7-1', endDate: '2026-07-03' },
      { startDate: '2026-07-01', endDate: '2026-02-30' },
    ])('rejects the range %j even without events', (range) => {
      expect(() => calculateRestrictionFrequency([], range)).toThrow(ValidationError);
    });

    it('rejects a relevant event with an invalid createdAt', () => {
      expect(() => calculateRestrictionFrequency([restriction('yesterday')])).toThrow(
        ValidationError,
      );
    });

    it('does not look at the timestamp of events it ignores', () => {
      expect(() => calculateRestrictionFrequency([makeEvent('error', 'yesterday')])).not.toThrow();
    });
  });
});
