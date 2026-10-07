import type { LifecycleEvent } from '@persona/core';

import { assertDateRange, isWithinRange, toUtcDateString } from './dates.js';
import type { DateRange, PublicationMetrics } from './types.js';

/**
 * Counts the publications of content. A publication is an `action_performed` (published) or
 * `action_failed` (failed) event with `action: 'post'` whose payload names the `contentId` of the
 * item; a `post` action without a content item is not a publication. With `range`, only events of
 * those UTC dates (inclusive) count.
 */
export function calculatePublicationMetrics(
  events: LifecycleEvent[],
  range?: DateRange,
): PublicationMetrics {
  assertDateRange(range);

  let published = 0;
  let failed = 0;
  for (const event of events) {
    if (event.type !== 'action_performed' && event.type !== 'action_failed') {
      continue;
    }
    if (event.payload.action !== 'post' || typeof event.payload.contentId !== 'string') {
      continue;
    }
    if (!isWithinRange(toUtcDateString(event.createdAt), range)) {
      continue;
    }

    if (event.type === 'action_performed') {
      published += 1;
    } else {
      failed += 1;
    }
  }

  return { total: published + failed, published, failed };
}
