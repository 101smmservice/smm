import { ValidationError, type Account, type AccountStatus } from '@persona/core';
import { describe, expect, it } from 'vitest';

import { summarizeAccounts } from '../src/index.js';

function makeAccounts(statuses: AccountStatus[]): Account[] {
  return statuses.map((status, index) => ({
    id: `acc_${String(index)}`,
    platform: 'telegram',
    status,
    personaId: null,
    deviceProfileId: null,
    proxyBindingId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    connectedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
  }));
}

const ZERO_COUNTS = {
  connected: 0,
  onboarding: 0,
  warming: 0,
  active: 0,
  limited: 0,
  review: 0,
  dead: 0,
};

describe('summarizeAccounts', () => {
  it('returns zero counts and zero rates for an empty list', () => {
    expect(summarizeAccounts([])).toEqual({
      total: 0,
      byStatus: ZERO_COUNTS,
      activeRate: 0,
      limitedRate: 0,
      reviewRate: 0,
      deadRate: 0,
    });
  });

  it('counts accounts per status', () => {
    const summary = summarizeAccounts(
      makeAccounts(['active', 'active', 'active', 'limited', 'review', 'dead', 'warming']),
    );

    expect(summary.total).toBe(7);
    expect(summary.byStatus).toEqual({
      ...ZERO_COUNTS,
      active: 3,
      limited: 1,
      review: 1,
      dead: 1,
      warming: 1,
    });
  });

  it('derives the rates of the key statuses from the total', () => {
    const summary = summarizeAccounts(
      makeAccounts([
        'active',
        'active',
        'active',
        'active',
        'limited',
        'limited',
        'review',
        'dead',
        'warming',
        'onboarding',
      ]),
    );

    expect(summary.activeRate).toBeCloseTo(0.4, 10);
    expect(summary.limitedRate).toBeCloseTo(0.2, 10);
    expect(summary.reviewRate).toBeCloseTo(0.1, 10);
    expect(summary.deadRate).toBeCloseTo(0.1, 10);
  });

  it('keeps every rate between 0 and 1', () => {
    for (const statuses of [
      ['active'],
      ['dead', 'dead'],
      ['active', 'limited', 'review', 'dead'],
    ]) {
      const summary = summarizeAccounts(makeAccounts(statuses as AccountStatus[]));

      for (const rate of [
        summary.activeRate,
        summary.limitedRate,
        summary.reviewRate,
        summary.deadRate,
      ]) {
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
    }
    expect(summarizeAccounts(makeAccounts(['active'])).activeRate).toBe(1);
  });

  it('does not mutate the input', () => {
    const accounts = makeAccounts(['active', 'dead', 'limited']);
    const snapshot = structuredClone(accounts);
    Object.freeze(accounts);
    for (const account of accounts) {
      Object.freeze(account);
    }

    summarizeAccounts(accounts);

    expect(accounts).toEqual(snapshot);
  });

  it('rejects an account with an unknown status', () => {
    const accounts = makeAccounts(['active']);
    const [first] = accounts;
    if (first === undefined) {
      throw new Error('fixture is empty');
    }
    first.status = 'banned' as unknown as AccountStatus;

    expect(() => summarizeAccounts(accounts)).toThrow(ValidationError);
  });
});
