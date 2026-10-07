import type { LifecycleEvent } from '@persona/core';

import { assertDateRange, compareDateStrings, isWithinRange, toUtcDateString } from './dates.js';
import type { DailyActionFailureMetric, DateRange } from './types.js';

/**
 * Counts `action_performed` (successful) and `action_failed` events per UTC day of `createdAt` and
 * derives `failureRate = failed / (performed + failed)`. Days without such events produce no row.
 */
export function calculateActionFailureMetrics(
  events: LifecycleEvent[],
  range?: DateRange,
): DailyActionFailureMetric[] {
  assertDateRange(range);

  const days = new Map<string, { performed: number; failed: number }>();
  for (const event of events) {
    if (event.type !== 'action_performed' && event.type !== 'action_failed') {
      continue;
    }
    const date = toUtcDateString(event.createdAt);
    if (!isWithinRange(date, range)) {
      continue;
    }

    const day = days.get(date) ?? { performed: 0, failed: 0 };
    if (event.type === 'action_performed') {
      day.performed += 1;
    } else {
      day.failed += 1;
    }
    days.set(date, day);
  }

  return [...days.entries()]
    .map(([date, { performed, failed }]) => ({
      date,
      performed,
      failed,
      failureRate: failed / (performed + failed),
    }))
    .sort((a, b) => compareDateStrings(a.date, b.date));
}
