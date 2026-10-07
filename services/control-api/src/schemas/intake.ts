import { INTAKE_SOURCES, INTAKE_STATUSES } from '@persona/account-intake';
import { PLATFORMS } from '@persona/core';
import { z } from 'zod';

import { idString, metadataSchema, nonEmptyText } from './common.js';

const externalText = z.string().refine((value) => value.trim() !== '', {
  message: 'must not be empty',
});

export const intakeParams = z.strictObject({ requestId: idString });

export const createIntakeBody = z.strictObject({
  platform: z.enum(PLATFORMS),
  externalAccountId: externalText.nullable().optional(),
  externalUsername: externalText.nullable().optional(),
  source: z.enum(INTAKE_SOURCES).optional(),
  desiredPersonaId: idString.nullable().optional(),
  notes: z.string().nullable().optional(),
  metadata: metadataSchema.optional(),
});

export const listIntakeQuery = z.strictObject({
  status: z.enum(INTAKE_STATUSES).optional(),
});

/** Submitting a request is itself the confirmation of ownership, so `false` is not accepted. */
export const submitIntakeBody = z.strictObject({
  ownershipConfirmed: z.boolean().refine((value) => value, {
    message: 'ownership of the account must be confirmed',
  }),
});

/** A missing or false `confirmOwnership` is answered with 409 by the route, not rejected here. */
export const approveIntakeBody = z.strictObject({
  confirmOwnership: z.boolean().optional(),
  reviewerNote: nonEmptyText.optional(),
});

export const rejectIntakeBody = z.strictObject({ reason: nonEmptyText });

export const reopenIntakeBody = z.strictObject({});

export const completeIntakeBody = z.strictObject({ personaId: idString.optional() });

export type CreateIntakeBody = z.infer<typeof createIntakeBody>;
