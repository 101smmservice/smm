import { isAccountStatus, ValidationError, type Account } from '@persona/core';

import { compareDateStrings, getUtcDateString, toUtcDateString } from './dates.js';
import type { CohortSurvivalPoint } from './types.js';

export const DEFAULT_SURVIVAL_DAYS: readonly number[] = [1, 3, 7, 14, 30];

const MS_PER_DAY = 86_400_000;

export interface CohortSurvivalOptions {
  /** Ages, in days since the cohort date, at which survival is reported. */
  days?: number[];
  /** The moment survival is measured at. Defaults to the current time. */
  now?: Date;
}

/**
 * Share of each cohort that is not `dead`, reported for every requested age the cohort has reached.
 *
 * A cohort is the UTC date of `connectedAt` (or of `createdAt` when the account was never
 * connected). The age of a cohort is the number of whole UTC calendar days between that date and
 * `now`, so all accounts of a cohort enter or miss a point together.
 *
 * This is a simplified snapshot of the current moment: "alive" means the account's current status is
 * not `dead`, because no historical status snapshots are available. A cohort's survival at day 7
 * therefore reflects deaths that happened after day 7 as well.
 */
export function calculateCohortSurvival(
  accounts: Account[],
  options: CohortSurvivalOptions = {},
): CohortSurvivalPoint[] {
  const days = normalizeDays(options.days ?? DEFAULT_SURVIVAL_DAYS);
  const todayMs = Date.parse(`${getUtcDateString(options.now ?? new Date())}T00:00:00.000Z`);

  const cohorts = new Map<string, { total: number; alive: number }>();
  for (const account of accounts) {
    if (!isAccountStatus(account.status)) {
      throw new ValidationError(
        `account ${account.id} has an unknown status: ${String(account.status)}`,
        'status',
      );
    }

    const cohortDate = toUtcDateString(account.connectedAt ?? account.createdAt);
    const cohort = cohorts.get(cohortDate) ?? { total: 0, alive: 0 };
    cohort.total += 1;
    if (account.status !== 'dead') {
      cohort.alive += 1;
    }
    cohorts.set(cohortDate, cohort);
  }

  const points: CohortSurvivalPoint[] = [];
  for (const [cohortDate, { total, alive }] of cohorts) {
    const ageDays = Math.floor((todayMs - Date.parse(`${cohortDate}T00:00:00.000Z`)) / MS_PER_DAY);
    for (const day of days) {
      if (ageDays >= day) {
        points.push({ cohortDate, day, total, alive, survivalRate: alive / total });
      }
    }
  }

  return points.sort((a, b) => compareDateStrings(a.cohortDate, b.cohortDate) || a.day - b.day);
}

function normalizeDays(days: readonly number[]): number[] {
  for (const day of days) {
    if (!Number.isInteger(day) || day < 0) {
      throw new ValidationError('days must be non-negative integers', 'days');
    }
  }
  return [...new Set(days)].sort((a, b) => a - b);
}
