import { isAccountStatus, type AccountStatus, type ActivityPolicy } from '@persona/core';

import type { PolicyProvider } from './policy-provider.js';

export const EMPTY_POLICY_STAGE = 'none';

const POLICY_KEY_BY_STATUS: Readonly<Record<AccountStatus, string | null>> = {
  connected: null,
  onboarding: 'onboarding',
  warming: 'warming_week_1',
  active: 'active',
  limited: 'onboarding',
  review: null,
  dead: null,
};

/** Maps an account status to the key of its activity policy, or `null` when it has none. */
export function getPolicyKey(status: AccountStatus): string | null {
  return isAccountStatus(status) ? POLICY_KEY_BY_STATUS[status] : null;
}

/** A policy that allows nothing: no sessions, zero budgets, every day is a skip day. */
export function createEmptyPolicy(): ActivityPolicy {
  return {
    stage: EMPTY_POLICY_STAGE,
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
  };
}

export function isEmptyPolicy(policy: ActivityPolicy): boolean {
  return policy.stage === EMPTY_POLICY_STAGE;
}

/** Resolves the policy for a status; falls back to the empty policy instead of throwing. */
export function resolvePolicy(status: AccountStatus, provider: PolicyProvider): ActivityPolicy {
  const key = getPolicyKey(status);
  if (key === null) {
    return createEmptyPolicy();
  }
  return provider.getPolicyByKey(key) ?? createEmptyPolicy();
}
