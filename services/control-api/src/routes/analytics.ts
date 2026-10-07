import { createAnalyticsSnapshot, type DateRange } from '@persona/analytics';
import type { FastifyInstance } from 'fastify';

import type { ControlApiContainer } from '../container.js';
import { snapshotQuery } from '../schemas/analytics.js';
import { parseRequest } from '../schemas/common.js';

/** Bounds used when only one end of the range is given. */
const EARLIEST_DATE = '1970-01-01';
const LATEST_DATE = '9999-12-31';

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  container: ControlApiContainer,
): void {
  app.get('/analytics/snapshot', async (request) => {
    const query = parseRequest('query', snapshotQuery, request.query);

    const range: DateRange | undefined =
      query.startDate === undefined && query.endDate === undefined
        ? undefined
        : {
            startDate: query.startDate ?? EARLIEST_DATE,
            endDate: query.endDate ?? LATEST_DATE,
          };

    const [accounts, events] = await Promise.all([
      container.accounts.list(),
      container.events.query({}),
    ]);
    return createAnalyticsSnapshot(accounts, events, {
      now: container.clock.now(),
      range,
      survivalDays: query.survivalDays,
    });
  });
}
