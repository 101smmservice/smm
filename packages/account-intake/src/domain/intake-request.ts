import { isPlatform, type Platform } from '@persona/core';

import { IntakeValidationError } from '../errors.js';
import type { IntakeStatus } from './intake-status.js';

export const INTAKE_SOURCES = ['manual', 'import', 'api'] as const;

export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export function isIntakeSource(value: unknown): value is IntakeSource {
  return typeof value === 'string' && (INTAKE_SOURCES as readonly string[]).includes(value);
}

export interface IntakeRequest {
  id: string;
  platform: Platform;
  externalAccountId: string | null;
  externalUsername: string | null;
  source: IntakeSource;
  desiredPersonaId: string | null;
  /** Whether the person submitting the request confirmed that they own the account. */
  ownershipConfirmed: boolean;
  notes: string | null;
  status: IntakeStatus;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  /** ISO 8601 */
  submittedAt: string | null;
  /** ISO 8601 */
  reviewedAt: string | null;
  /** ISO 8601 */
  completedAt: string | null;
  rejectionReason: string | null;
  completedAccountId: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateIntakeRequestDraftInput {
  id: string;
  platform: Platform;
  externalAccountId?: string | null;
  externalUsername?: string | null;
  source?: IntakeSource;
  desiredPersonaId?: string | null;
  notes?: string | null;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

/** Creates a new request in the `draft` status. Input objects are copied, never shared. */
export function createIntakeRequestDraft(input: CreateIntakeRequestDraftInput): IntakeRequest {
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new IntakeValidationError('id must be a non-empty string', 'id');
  }
  if (!isPlatform(input.platform)) {
    throw new IntakeValidationError(
      `unknown platform: ${JSON.stringify(input.platform)}`,
      'platform',
    );
  }

  const source = input.source ?? 'manual';
  if (!isIntakeSource(source)) {
    throw new IntakeValidationError(`unknown source: ${JSON.stringify(source)}`, 'source');
  }

  const notes = input.notes ?? null;
  if (notes !== null && typeof notes !== 'string') {
    throw new IntakeValidationError('notes must be a string', 'notes');
  }

  const createdAtDate = input.createdAt ?? new Date();
  if (!(createdAtDate instanceof Date) || Number.isNaN(createdAtDate.getTime())) {
    throw new IntakeValidationError('createdAt must be a valid Date', 'createdAt');
  }
  const createdAt = createdAtDate.toISOString();

  return {
    id: input.id,
    platform: input.platform,
    externalAccountId: optionalText(input.externalAccountId, 'externalAccountId'),
    externalUsername: optionalText(input.externalUsername, 'externalUsername'),
    source,
    desiredPersonaId: optionalText(input.desiredPersonaId, 'desiredPersonaId'),
    ownershipConfirmed: false,
    notes,
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
    submittedAt: null,
    reviewedAt: null,
    completedAt: null,
    rejectionReason: null,
    completedAccountId: null,
    metadata: copyMetadata(input.metadata),
  };
}

/** `null` and `undefined` mean "not given"; anything else must be a non-blank string. */
function optionalText(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new IntakeValidationError(`${field} must be a non-empty string when given`, field);
  }
  return value;
}

function copyMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (metadata === undefined) {
    return {};
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new IntakeValidationError('metadata must be an object', 'metadata');
  }
  try {
    return structuredClone(metadata);
  } catch {
    throw new IntakeValidationError('metadata must contain only plain data', 'metadata');
  }
}
