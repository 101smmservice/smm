import type { AccountStatus, ActivityPolicy } from '@persona/core';
import { describe, expect, it } from 'vitest';

import {
  createEmptyPolicy,
  getPolicyKey,
  isEmptyPolicy,
  resolvePolicy,
  StaticPolicyProvider,
} from '../src/index.js';

function makePolicy(stage: string): ActivityPolicy {
  return {
    stage,
    maxSessionMinutes: 10,
    sessionsPerDay: [1, 2],
    actions: {
      view: { maxPerDay: 10, probabilityPerEncounter: 1 },
      like: { maxPerDay: 1, probabilityPerEncounter: 0.1 },
      follow: { maxPerDay: 0, probabilityPerEncounter: 0 },
      post: { maxPerDay: 0, probabilityPerEncounter: 0 },
      comment: { maxPerDay: 0, probabilityPerEncounter: 0 },
    },
    minIntervalMinutes: [1, 2],
    skipDayProbability: 0,
  };
}

describe('getPolicyKey', () => {
  it.each<[AccountStatus, string | null]>([
    ['connected', null],
    ['onboarding', 'onboarding'],
    ['warming', 'warming_week_1'],
    ['active', 'active'],
    ['limited', 'onboarding'],
    ['review', null],
    ['dead', null],
  ])('maps %s to %j', (status, key) => {
    expect(getPolicyKey(status)).toBe(key);
  });

  it('returns null for an unknown status', () => {
    expect(getPolicyKey('banned' as unknown as AccountStatus)).toBeNull();
  });
});

describe('createEmptyPolicy', () => {
  it('allows nothing', () => {
    const policy = createEmptyPolicy();

    expect(policy).toEqual({
      stage: 'none',
      maxSessionMinutes: 0,
      sessionsPerDay: [0, 0],
      actions: {
        view: { maxPerDay: 0, probabilityPerEncounter: 0 },
        like: { maxPerDay: 0, probabilityPerEncounter: 0 },
        follow: { maxPerDay: 0, probabilityPerEncounter: 0 },
        post: { maxPerDay: 0, probabilityPerEncounter: 0 },
        comment: { maxPerDay: 0, probabilityPerEncounter: 0 },
      },
      minIntervalMinutes: [0, 0],
      skipDayProbability: 1,
    });
    expect(isEmptyPolicy(policy)).toBe(true);
  });

  it('returns a fresh object on every call', () => {
    expect(createEmptyPolicy()).not.toBe(createEmptyPolicy());
  });

  it('is not confused with a real policy', () => {
    expect(isEmptyPolicy(makePolicy('active'))).toBe(false);
  });
});

describe('resolvePolicy', () => {
  const provider = new StaticPolicyProvider({
    onboarding: makePolicy('onboarding'),
    active: makePolicy('active'),
  });

  it('returns the policy mapped to the status', () => {
    expect(resolvePolicy('active', provider).stage).toBe('active');
    expect(resolvePolicy('onboarding', provider).stage).toBe('onboarding');
  });

  it('gives a limited account the onboarding policy', () => {
    expect(resolvePolicy('limited', provider).stage).toBe('onboarding');
  });

  it.each<AccountStatus>(['connected', 'review', 'dead'])(
    'returns the empty policy for %s',
    (status) => {
      expect(isEmptyPolicy(resolvePolicy(status, provider))).toBe(true);
    },
  );

  it('returns the empty policy instead of throwing when the provider has no such key', () => {
    expect(isEmptyPolicy(resolvePolicy('warming', provider))).toBe(true);
  });
});

describe('StaticPolicyProvider', () => {
  it('returns null for unknown keys, including inherited object properties', () => {
    const provider = new StaticPolicyProvider({ active: makePolicy('active') });

    expect(provider.getPolicyByKey('missing')).toBeNull();
    expect(provider.getPolicyByKey('constructor')).toBeNull();
  });
});
