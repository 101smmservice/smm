import { z } from 'zod';

import { idString, nonEmptyText } from './common.js';

const activityWindow = z
  .strictObject({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
    weekendActive: z.boolean(),
  })
  .refine((window) => window.startHour < window.endHour, {
    message: 'startHour must be less than endHour',
    path: ['startHour'],
  });

/** Topics are trimmed and blank ones dropped; at least one must remain. */
const topics = z
  .array(z.string())
  .transform((values) => values.map((value) => value.trim()).filter((value) => value !== ''))
  .refine((values) => values.length > 0, { message: 'must contain at least one non-empty topic' });

const personaFields = {
  timezone: nonEmptyText,
  locale: nonEmptyText,
  niche: nonEmptyText,
  tone: nonEmptyText,
  topics,
  audience: nonEmptyText,
  activityWindow,
};

export const personaParams = z.strictObject({ personaId: idString });

export const createPersonaBody = z.strictObject(personaFields);

/** Only the given fields are changed; the resulting persona is validated as a whole. */
export const updatePersonaBody = z.strictObject(personaFields).partial();

export type CreatePersonaBody = z.infer<typeof createPersonaBody>;
export type UpdatePersonaBody = z.infer<typeof updatePersonaBody>;
