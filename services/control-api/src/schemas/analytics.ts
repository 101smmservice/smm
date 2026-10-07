import { z } from 'zod';

import { DATE_RANGE_ORDER_MESSAGE, dateString, hasOrderedDateRange } from './common.js';

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** `"1,3,7"` becomes `[1, 3, 7]`; every item must be a positive integer. */
const survivalDays = z
  .string()
  .refine((value) => value.split(',').every((item) => POSITIVE_INTEGER.test(item.trim())), {
    message: 'must be a comma-separated list of positive integers, e.g. "1,3,7,14,30"',
  })
  .transform((value) => value.split(',').map((item) => Number(item.trim())));

export const snapshotQuery = z
  .strictObject({
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    survivalDays: survivalDays.optional(),
  })
  .refine(hasOrderedDateRange, { message: DATE_RANGE_ORDER_MESSAGE, path: ['startDate'] });

export type SnapshotQuery = z.infer<typeof snapshotQuery>;
