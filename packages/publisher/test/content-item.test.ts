import { ValidationError } from '@persona/core';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_FORMATS,
  CONTENT_STATUSES,
  createContentItemDraft,
  createEmptyStatusCounts,
  isContentFormat,
  isContentStatus,
  isValidDateString,
  isValidIsoTimestamp,
  type ContentFormat,
} from '../src/index.js';

describe('content formats and statuses', () => {
  it('list the supported values', () => {
    expect([...CONTENT_FORMATS]).toEqual(['post', 'video', 'story', 'article']);
    expect([...CONTENT_STATUSES]).toEqual([
      'draft',
      'brief_ready',
      'planned',
      'ready',
      'scheduled',
      'published',
      'failed',
      'rejected',
      'archived',
    ]);
  });

  it.each(CONTENT_FORMATS)('recognise the format %s', (format) => {
    expect(isContentFormat(format)).toBe(true);
  });

  it.each(CONTENT_STATUSES)('recognise the status %s', (status) => {
    expect(isContentStatus(status)).toBe(true);
  });

  it.each(['', 'reel', 'POST', null, undefined, 1])(
    'reject %j as a format and as a status',
    (value) => {
      expect(isContentFormat(value)).toBe(false);
      expect(isContentStatus(value)).toBe(false);
    },
  );

  it('provide zeroed counts for every status', () => {
    const counts = createEmptyStatusCounts();

    expect(Object.keys(counts).sort()).toEqual([...CONTENT_STATUSES].sort());
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    expect(createEmptyStatusCounts()).not.toBe(counts);
  });
});

describe('isValidDateString', () => {
  it.each(['2026-07-01', '2028-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(isValidDateString(value)).toBe(true);
  });

  it.each([
    '2026-7-1',
    '2026/07/01',
    '01.07.2026',
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '',
    'x',
  ])('rejects %j', (value) => {
    expect(isValidDateString(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidDateString(20260701)).toBe(false);
    expect(isValidDateString(null)).toBe(false);
    expect(isValidDateString(new Date())).toBe(false);
  });
});

describe('isValidIsoTimestamp', () => {
  it.each([
    '2026-07-01T10:00:00Z',
    '2026-07-01T10:00:00.000Z',
    '2026-07-01T10:00:00.123456Z',
    '2026-07-01T10:00Z',
    '2026-07-01T10:00:00+03:00',
    '2026-07-01T23:59:59-05:30',
  ])('accepts %s', (value) => {
    expect(isValidIsoTimestamp(value)).toBe(true);
  });

  it.each([
    '2026-07-01',
    '2026-07-01T10:00:00',
    '2026-07-01 10:00:00Z',
    '2026-02-30T10:00:00Z',
    '2026-07-01T24:00:00Z',
    '2026-07-01T10:60:00Z',
    '2026-07-01T10:00:60Z',
    '2026-07-01T10:00:00+25:00',
    'July 1, 2026 10:00 UTC',
    'tomorrow',
    '',
  ])('rejects %j', (value) => {
    expect(isValidIsoTimestamp(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidIsoTimestamp(1_782_900_000_000)).toBe(false);
    expect(isValidIsoTimestamp(null)).toBe(false);
    expect(isValidIsoTimestamp(new Date())).toBe(false);
  });
});

describe('createContentItemDraft', () => {
  const createdAt = new Date('2026-07-01T08:00:00.000Z');

  it('creates a draft with the given fields', () => {
    const item = createContentItemDraft({
      id: 'item_1',
      accountId: 'acc_1',
      personaId: 'persona_1',
      format: 'video',
      title: 'Title',
      brief: 'Brief',
      caption: 'Caption',
      mediaRefs: ['media/1.mp4'],
      topics: ['cooking', 'travel'],
      cta: 'Subscribe',
      createdAt,
      metadata: { source: 'test' },
    });

    expect(item).toEqual({
      id: 'item_1',
      accountId: 'acc_1',
      personaId: 'persona_1',
      format: 'video',
      title: 'Title',
      brief: 'Brief',
      caption: 'Caption',
      mediaRefs: ['media/1.mp4'],
      topics: ['cooking', 'travel'],
      cta: 'Subscribe',
      status: 'draft',
      createdAt: '2026-07-01T08:00:00.000Z',
      updatedAt: '2026-07-01T08:00:00.000Z',
      plannedDate: null,
      scheduledAt: null,
      publishedAt: null,
      externalId: null,
      failureReason: null,
      metadata: { source: 'test' },
    });
  });

  it('always starts as a draft and defaults optional fields to null or empty', () => {
    const item = createContentItemDraft({
      id: 'item_1',
      accountId: 'acc_1',
      format: 'story',
      createdAt,
    });

    expect(item.status).toBe('draft');
    expect(item.updatedAt).toBe(item.createdAt);
    expect(item.personaId).toBeNull();
    expect(item.title).toBeNull();
    expect(item.brief).toBeNull();
    expect(item.caption).toBeNull();
    expect(item.cta).toBeNull();
    expect(item.mediaRefs).toEqual([]);
    expect(item.topics).toEqual([]);
    expect(item.metadata).toEqual({});
    expect(item.plannedDate).toBeNull();
    expect(item.scheduledAt).toBeNull();
    expect(item.publishedAt).toBeNull();
    expect(item.externalId).toBeNull();
    expect(item.failureReason).toBeNull();
  });

  it('defaults createdAt to the current time', () => {
    const before = Date.now();
    const item = createContentItemDraft({ id: 'item_1', accountId: 'acc_1', format: 'post' });
    const after = Date.now();

    expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
    expect(Date.parse(item.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(item.createdAt)).toBeLessThanOrEqual(after);
  });

  it('copies the input collections instead of sharing them', () => {
    const mediaRefs = ['media/1.png'];
    const topics = ['cooking'];
    const metadata = { source: 'test' };

    const item = createContentItemDraft({
      id: 'item_1',
      accountId: 'acc_1',
      format: 'post',
      mediaRefs,
      topics,
      metadata,
      createdAt,
    });
    mediaRefs.push('media/2.png');
    topics.push('travel');
    metadata.source = 'changed';

    expect(item.mediaRefs).toEqual(['media/1.png']);
    expect(item.topics).toEqual(['cooking']);
    expect(item.metadata).toEqual({ source: 'test' });
  });

  it.each(['', '   '])('throws a ValidationError for the blank accountId %j', (accountId) => {
    expect(() => createContentItemDraft({ id: 'item_1', accountId, format: 'post' })).toThrow(
      ValidationError,
    );
  });

  it('throws a ValidationError for a blank id, an unknown format or an invalid date', () => {
    expect(() => createContentItemDraft({ id: '', accountId: 'acc_1', format: 'post' })).toThrow(
      ValidationError,
    );
    expect(() =>
      createContentItemDraft({
        id: 'i',
        accountId: 'acc_1',
        format: 'reel' as unknown as ContentFormat,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      createContentItemDraft({
        id: 'i',
        accountId: 'acc_1',
        format: 'post',
        createdAt: new Date('nope'),
      }),
    ).toThrow(ValidationError);
  });
});
