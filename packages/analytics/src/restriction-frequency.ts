import type { LifecycleEvent } from '@persona/core';

import { assertDateRange, compareDateStrings, isWithinRange, toUtcDateString } from './dates.js';
import type { DailyRestrictionMetric, DateRange } from './types.js';

/**
 * Counts `restriction_detected` events per UTC day of `createdAt`, together with the number of
 * distinct accounts affected that day. Days without such events produce no row.
 */
export function calculateRestrictionFrequency(
  events: LifecycleEvent[],
  range?: DateRange,
): DailyRestrictionMetric[] {
  assertDateRange(range);

  const days = new Map<string, { events: number; accounts: Set<string> }>();
  for (const event of events) {
    if (event.type !== 'restriction_detected') {
      continue;
    }
    const date = toUtcDateString(event.createdAt);
    if (!isWithinRange(date, range)) {
      continue;
    }

    const day = days.get(date) ?? { events: 0, accounts: new Set<string>() };
    day.events += 1;
    day.accounts.add(event.accountId);
    days.set(date, day);
  }

  return [...days.entries()]
    .map(([date, day]) => ({
      date,
      restrictionEvents: day.events,
      accountsAffected: day.accounts.size,
    }))
    .sort((a, b) => compareDateStrings(a.date, b.date));
}
