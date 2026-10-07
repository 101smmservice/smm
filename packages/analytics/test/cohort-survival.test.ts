import { ValidationError, type Account, type AccountStatus } from '@persona/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateCohortSurvival, DEFAULT_SURVIVAL_DAYS } from '../src/index.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');

let counter = 0;

function makeAccount(overrides: Partial<Account> = {}): Account {
  counter += 1;
  return {
    id: `acc_${String(counter)}`,
    platform: 'telegram',
    status: 'active',
    personaId: null,
    deviceProfileId: null,
    proxyBindingId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    connectedAt: '2026-07-01T08:00:00.000Z',
    statusChangedAt: '2026-07-01T08:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function connectedOn(date: string, status: AccountStatus = 'active'): Account {
  return makeAccount({ connectedAt: `${date}T08:00:00.000Z`, status });
}

describe('calculateCohortSurvival', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty array when there are no accounts', () => {
    expect(calculateCohortSurvival([], { now: NOW })).toEqual([]);
  });

  it('builds the cohort from connectedAt', () => {
    const account = makeAccount({
      createdAt: '2026-05-01T00:00:00.000Z',
      connectedAt: '2026-07-01T08:00:00.000Z',
    });

    const points = calculateCohortSurvival([account], { now: NOW, days: [7] });

    expect(points).toEqual([
      { cohortDate: '2026-07-01', day: 7, total: 1, alive: 1, survivalRate: 1 },
    ]);
  });

  it('falls back to createdAt when the account was never connected', () => {
    const account = makeAccount({ createdAt: '2026-07-10T20:00:00.000Z', connectedAt: null });

    const points = calculateCohortSurvival([account], { now: NOW, days: [7] });

    expect(points.map((point) => point.cohortDate)).toEqual(['2026-07-10']);
  });

  it('uses the UTC date of a timestamp written with an offset', () => {
    const account = makeAccount({ connectedAt: '2026-07-01T23:30:00-05:00' });

    const points = calculateCohortSurvival([account], { now: NOW, days: [1] });

    expect(points.map((point) => point.cohortDate)).toEqual(['2026-07-02']);
  });

  it('leaves out accounts that are too young for a day', () => {
    const accounts = [
      connectedOn('2026-07-01'),
      connectedOn('2026-07-26'),
      connectedOn('2026-07-30'),
    ];

    const points = calculateCohortSurvival(accounts, { now: NOW, days: [3] });

    expect(points.map((point) => point.cohortDate)).toEqual(['2026-07-01', '2026-07-26']);
  });

  it('measures age in whole UTC calendar days', () => {
    const justBeforeMidnight = makeAccount({ connectedAt: '2026-07-30T23:59:00.000Z' });
    const now = new Date('2026-07-31T00:01:00.000Z');

    expect(calculateCohortSurvival([justBeforeMidnight], { now, days: [1] })).toHaveLength(1);
    expect(calculateCohortSurvival([justBeforeMidnight], { now, days: [2] })).toHaveLength(0);
  });

  it('reports day 0 for a cohort created today but not for one from the future', () => {
    const today = connectedOn('2026-07-31');
    const future = connectedOn('2026-08-05');

    const points = calculateCohortSurvival([today, future], { now: NOW, days: [0, 1] });

    expect(points).toEqual([
      { cohortDate: '2026-07-31', day: 0, total: 1, alive: 1, survivalRate: 1 },
    ]);
  });

  it('does not count dead accounts as alive', () => {
    const accounts = [
      connectedOn('2026-07-01', 'active'),
      connectedOn('2026-07-01', 'dead'),
      connectedOn('2026-07-01', 'dead'),
      connectedOn('2026-07-01', 'limited'),
    ];

    const [point] = calculateCohortSurvival(accounts, { now: NOW, days: [7] });

    expect(point).toEqual({
      cohortDate: '2026-07-01',
      day: 7,
      total: 4,
      alive: 2,
      survivalRate: 0.5,
    });
  });

  it('treats every non-dead status as alive', () => {
    const statuses: AccountStatus[] = [
      'connected',
      'onboarding',
      'warming',
      'active',
      'limited',
      'review',
    ];

    const [point] = calculateCohortSurvival(
      statuses.map((status) => connectedOn('2026-07-01', status)),
      { now: NOW, days: [1] },
    );

    expect(point?.alive).toBe(6);
    expect(point?.survivalRate).toBe(1);
  });

  it('calculates the survival rate per cohort', () => {
    const accounts = [
      connectedOn('2026-07-01', 'active'),
      connectedOn('2026-07-01', 'dead'),
      connectedOn('2026-07-01', 'dead'),
      connectedOn('2026-07-10', 'active'),
      connectedOn('2026-07-10', 'active'),
      connectedOn('2026-07-10', 'active'),
      connectedOn('2026-07-10', 'dead'),
    ];

    const points = calculateCohortSurvival(accounts, { now: NOW, days: [7] });

    expect(points).toHaveLength(2);
    expect(points[0]?.survivalRate).toBeCloseTo(1 / 3, 10);
    expect(points[1]?.survivalRate).toBe(0.75);
  });

  it('applies the default days when none are given', () => {
    const points = calculateCohortSurvival([connectedOn('2026-06-01')], { now: NOW });

    expect([...DEFAULT_SURVIVAL_DAYS]).toEqual([1, 3, 7, 14, 30]);
    expect(points.map((point) => point.day)).toEqual([1, 3, 7, 14, 30]);
  });

  it('only reports the default days a cohort has reached', () => {
    const points = calculateCohortSurvival([connectedOn('2026-07-20')], { now: NOW });

    expect(points.map((point) => point.day)).toEqual([1, 3, 7]);
  });

  it('sorts by cohort date, then by day', () => {
    const accounts = [
      connectedOn('2026-07-20'),
      connectedOn('2026-07-01'),
      connectedOn('2026-07-10'),
    ];

    const points = calculateCohortSurvival(accounts, { now: NOW, days: [7, 1, 3] });

    expect(points.map((point) => `${point.cohortDate}/${String(point.day)}`)).toEqual([
      '2026-07-01/1',
      '2026-07-01/3',
      '2026-07-01/7',
      '2026-07-10/1',
      '2026-07-10/3',
      '2026-07-10/7',
      '2026-07-20/1',
      '2026-07-20/3',
      '2026-07-20/7',
    ]);
  });

  it('reports a repeated day only once', () => {
    const points = calculateCohortSurvival([connectedOn('2026-07-01')], {
      now: NOW,
      days: [3, 3, 1],
    });

    expect(points.map((point) => point.day)).toEqual([1, 3]);
  });

  it('uses the current time when now is not given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'));

    const points = calculateCohortSurvival([connectedOn('2026-07-01')], { days: [7, 14] });

    expect(points.map((point) => point.day)).toEqual([7]);
  });

  it('does not mutate the input', () => {
    const accounts = [connectedOn('2026-07-05'), connectedOn('2026-07-01', 'dead')];
    const snapshot = structuredClone(accounts);
    Object.freeze(accounts);

    calculateCohortSurvival(accounts, { now: NOW });

    expect(accounts).toEqual(snapshot);
  });

  describe('validation', () => {
    it.each([[-1], [1.5], [Number.NaN]])('rejects the day list %j', (...days) => {
      expect(() => calculateCohortSurvival([], { now: NOW, days })).toThrow(ValidationError);
    });

    it('rejects an invalid now', () => {
      expect(() => calculateCohortSurvival([], { now: new Date('nope') })).toThrow(ValidationError);
    });

    it('rejects an account without a usable start timestamp', () => {
      const account = makeAccount({ connectedAt: 'whenever' });

      expect(() => calculateCohortSurvival([account], { now: NOW })).toThrow(ValidationError);
    });

    it('rejects an account with an unknown status', () => {
      const account = makeAccount({ status: 'banned' as unknown as AccountStatus });

      expect(() => calculateCohortSurvival([account], { now: NOW })).toThrow(ValidationError);
    });
  });
});
