import type { Account, LifecycleEvent } from '@persona/core';

import { calculateActionFailureMetrics } from './action-failure-metrics.js';
import { calculateCohortSurvival } from './cohort-survival.js';
import { toIsoTimestamp } from './dates.js';
import { calculateRestrictionFrequency } from './restriction-frequency.js';
import { summarizeAccounts } from './summarize-accounts.js';
import { buildTransitionMatrix } from './transition-matrix.js';
import type { AnalyticsSnapshot, DateRange } from './types.js';

export interface AnalyticsSnapshotOptions {
  /** The moment the snapshot is taken at. Defaults to the current time. */
  now?: Date;
  /** Limits restriction and action-failure metrics to these dates (inclusive). */
  range?: DateRange;
  /** Ages, in days, reported by the cohort survival metric. */
  survivalDays?: number[];
}

/**
 * Computes every metric of the package over in-memory data. The status summary, the transition
 * matrix and cohort survival describe all given data; `range` narrows only the daily metrics.
 */
export function createAnalyticsSnapshot(
  accounts: Account[],
  events: LifecycleEvent[],
  options: AnalyticsSnapshotOptions = {},
): AnalyticsSnapshot {
  const now = options.now ?? new Date();

  return {
    generatedAt: toIsoTimestamp(now),
    statusSummary: summarizeAccounts(accounts),
    transitionMatrix: buildTransitionMatrix(events),
    restrictionFrequency: calculateRestrictionFrequency(events, options.range),
    actionFailureMetrics: calculateActionFailureMetrics(events, options.range),
    cohortSurvival: calculateCohortSurvival(accounts, { now, days: options.survivalDays }),
  };
}
