import type { Platform } from '@persona/core';
import { describe, expect, it } from 'vitest';

import {
  createIntakeRequestDraft,
  INTAKE_SOURCES,
  INTAKE_STATUSES,
  IntakeValidationError,
  isIntakeSource,
  isIntakeStatus,
  type IntakeSource,
} from '../src/index.js';

const createdAt = new Date('2026-07-01T08:00:00.000Z');

function draft(overrides: Record<string, unknown> = {}) {
  return createIntakeRequestDraft({
    id: 'req_1',
    platform: 'telegram',
    createdAt,
    ...overrides,
  });
}

describe('intake statuses and sources', () => {
  it('list the supported values', () => {
    expect([...INTAKE_STATUSES]).toEqual([
      'draft',
      'pending_review',
      'approved',
      'rejected',
      'completed',
    ]);
    expect([...INTAKE_SOURCES]).toEqual(['manual', 'import', 'api']);
  });

  it.each(INTAKE_STATUSES)('recognise the status %s', (status) => {
    expect(isIntakeStatus(status)).toBe(true);
  });

  it.each(INTAKE_SOURCES)('recognise the source %s', (source) => {
    expect(isIntakeSource(source)).toBe(true);
  });

  it.each(['', 'DRAFT', 'archived', null, undefined, 1])('reject %j', (value) => {
    expect(isIntakeStatus(value)).toBe(false);
    expect(isIntakeSource(value)).toBe(false);
  });
});

describe('createIntakeRequestDraft', () => {
  it('creates a request in the draft status', () => {
    expect(draft().status).toBe('draft');
  });

  it('applies the defaults', () => {
    expect(draft()).toEqual({
      id: 'req_1',
      platform: 'telegram',
      externalAccountId: null,
      externalUsername: null,
      source: 'manual',
      desiredPersonaId: null,
      ownershipConfirmed: false,
      notes: null,
      status: 'draft',
      createdAt: '2026-07-01T08:00:00.000Z',
      updatedAt: '2026-07-01T08:00:00.000Z',
      submittedAt: null,
      reviewedAt: null,
      completedAt: null,
      rejectionReason: null,
      completedAccountId: null,
      metadata: {},
    });
  });

  it('defaults source to manual, ownershipConfirmed to false and the external fields to null', () => {
    const request = draft();

    expect(request.source).toBe('manual');
    expect(request.ownershipConfirmed).toBe(false);
    expect(request.externalAccountId).toBeNull();
    expect(request.externalUsername).toBeNull();
  });

  it('keeps the given fields', () => {
    const request = draft({
      platform: 'x',
      externalAccountId: '12345',
      externalUsername: 'someone',
      source: 'import',
      desiredPersonaId: 'persona_1',
      notes: 'imported from a spreadsheet',
      metadata: { batch: 7 },
    });

    expect(request).toMatchObject({
      platform: 'x',
      externalAccountId: '12345',
      externalUsername: 'someone',
      source: 'import',
      desiredPersonaId: 'persona_1',
      notes: 'imported from a spreadsheet',
      metadata: { batch: 7 },
    });
  });

  it('sets updatedAt equal to createdAt and leaves every later field empty', () => {
    const request = draft();

    expect(request.updatedAt).toBe(request.createdAt);
    expect(request.submittedAt).toBeNull();
    expect(request.reviewedAt).toBeNull();
    expect(request.completedAt).toBeNull();
    expect(request.rejectionReason).toBeNull();
    expect(request.completedAccountId).toBeNull();
  });

  it('defaults createdAt to the current time', () => {
    const before = Date.now();
    const request = createIntakeRequestDraft({ id: 'req_1', platform: 'x' });
    const after = Date.now();

    expect(new Date(request.createdAt).toISOString()).toBe(request.createdAt);
    expect(Date.parse(request.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(request.createdAt)).toBeLessThanOrEqual(after);
  });

  it('copies metadata instead of using it by reference', () => {
    const metadata = { batch: 7, nested: { tags: ['a'] } };

    const request = draft({ metadata });
    metadata.batch = 8;
    metadata.nested.tags.push('b');

    expect(request.metadata).toEqual({ batch: 7, nested: { tags: ['a'] } });
    expect(request.metadata).not.toBe(metadata);
  });

  it.each(['facebook', '', 'Telegram', null, undefined, 1])(
    'throws an IntakeValidationError for the platform %j',
    (platform) => {
      expect(() => draft({ platform: platform as unknown as Platform })).toThrow(
        IntakeValidationError,
      );
    },
  );

  it.each(['', '   '])(
    'throws an IntakeValidationError for the empty externalAccountId %j',
    (value) => {
      expect(() => draft({ externalAccountId: value })).toThrow(IntakeValidationError);
    },
  );

  it.each(['', '   '])(
    'throws an IntakeValidationError for the empty externalUsername %j',
    (value) => {
      expect(() => draft({ externalUsername: value })).toThrow(IntakeValidationError);
    },
  );

  it('names the offending field in the error', () => {
    try {
      draft({ externalAccountId: '' });
      expect.unreachable('createIntakeRequestDraft should have thrown');
    } catch (error) {
      expect((error as IntakeValidationError).field).toBe('externalAccountId');
    }
  });

  it('accepts null as "not given" for the optional texts', () => {
    const request = draft({
      externalAccountId: null,
      externalUsername: null,
      desiredPersonaId: null,
    });

    expect(request.externalAccountId).toBeNull();
    expect(request.externalUsername).toBeNull();
    expect(request.desiredPersonaId).toBeNull();
  });

  it('throws an IntakeValidationError for a blank id, an unknown source, a bad persona id, bad notes, bad metadata or an invalid date', () => {
    for (const overrides of [
      { id: '' },
      { source: 'scrape' as unknown as IntakeSource },
      { desiredPersonaId: '  ' },
      { notes: 5 },
      { metadata: [] },
      { metadata: { run: () => 1 } },
      { createdAt: new Date('nope') },
    ]) {
      expect(() => draft(overrides), JSON.stringify(Object.keys(overrides))).toThrow(
        IntakeValidationError,
      );
    }
  });
});
