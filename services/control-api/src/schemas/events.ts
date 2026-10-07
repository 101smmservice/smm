import { LIFECYCLE_EVENT_TYPES } from '@persona/core';
import { z } from 'zod';

import {
  DATE_RANGE_ORDER_MESSAGE,
  dateString,
  hasOrderedDateRange,
  idString,
  isoTimestamp,
  metadataSchema,
} from './common.js';

export const createEventBody = z.strictObject({
  accountId: idString,
  type: z.enum(LIFECYCLE_EVENT_TYPES),
  payload: metadataSchema.optional(),
  createdAt: isoTimestamp.optional(),
});

export const listEventsQuery = z
  .strictObject({
    accountId: idString.optional(),
    type: z.enum(LIFECYCLE_EVENT_TYPES).optional(),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
  })
  .refine(hasOrderedDateRange, { message: DATE_RANGE_ORDER_MESSAGE, path: ['startDate'] });

export type CreateEventBody = z.infer<typeof createEventBody>;
export type ListEventsQuery = z.infer<typeof listEventsQuery>;
