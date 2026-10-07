import { CONTENT_FORMATS, CONTENT_STATUSES } from '@persona/publisher';
import { z } from 'zod';

import { dateString, idString, isoTimestamp, metadataSchema, nonEmptyText } from './common.js';

export const contentParams = z.strictObject({ contentId: idString });

export const contentPlanParams = z.strictObject({ accountId: idString });

export const createContentBody = z.strictObject({
  accountId: idString,
  personaId: idString.nullable().optional(),
  format: z.enum(CONTENT_FORMATS),
  title: z.string().nullable().optional(),
  brief: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  mediaRefs: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  cta: z.string().nullable().optional(),
  metadata: metadataSchema.optional(),
});

export const transitionContentBody = z.strictObject({
  to: z.enum(CONTENT_STATUSES),
  at: isoTimestamp.optional(),
  plannedDate: dateString.optional(),
  scheduledAt: isoTimestamp.optional(),
  externalId: nonEmptyText.optional(),
  failureReason: nonEmptyText.optional(),
  confirm: z.boolean().optional(),
});

export const confirmPublishedBody = z.strictObject({
  at: isoTimestamp.optional(),
  externalId: nonEmptyText.optional(),
  confirm: z.boolean().optional(),
});

export const markFailedBody = z.strictObject({
  reason: nonEmptyText,
  at: isoTimestamp.optional(),
});

export const contentPlanQuery = z.strictObject({ date: dateString });

export const listContentQuery = z.strictObject({
  accountId: idString.optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
});

export type CreateContentBody = z.infer<typeof createContentBody>;
export type TransitionContentBody = z.infer<typeof transitionContentBody>;
