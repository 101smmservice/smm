import { ACCOUNT_STATUSES, ACTION_TYPES, PLATFORMS } from '@persona/core';
import { z } from 'zod';

import { dateString, idString, isoTimestamp, metadataSchema } from './common.js';

export const accountParams = z.strictObject({ accountId: idString });

export const createAccountBody = z.strictObject({
  platform: z.enum(PLATFORMS),
  connectedAt: isoTimestamp.optional(),
  personaId: idString.nullable().optional(),
  metadata: metadataSchema.optional(),
});

export const listAccountsQuery = z.strictObject({
  status: z.enum(ACCOUNT_STATUSES).optional(),
});

export const transitionAccountBody = z.strictObject({
  to: z.enum(ACCOUNT_STATUSES),
  at: isoTimestamp.optional(),
  confirm: z.boolean().optional(),
});

export const assignPersonaBody = z.strictObject({ personaId: idString });

export const planQuery = z.strictObject({ date: dateString });

export const actionPermissionQuery = z.strictObject({ action: z.enum(ACTION_TYPES) });

export type CreateAccountBody = z.infer<typeof createAccountBody>;
export type TransitionAccountBody = z.infer<typeof transitionAccountBody>;
