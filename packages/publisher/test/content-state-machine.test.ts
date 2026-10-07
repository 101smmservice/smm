import { DomainError, ValidationError } from '@persona/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertContentTransition,
  canTransitionContent,
  CONTENT_STATUSES,
  ContentValidationError,
  createContentItemDraft,
  InvalidContentTransitionError,
  PublisherError,
  requiresManualConfirmation,
  transitionContentItem,
  type ContentItem,
  type ContentStatus,
} from '../src/index.js';

/** The transition table from the specification, written out independently of the implementation. */
const EXPECTED: Record<ContentStatus, ContentStatus[]> = {
  draft: ['brief_ready', 'rejected', 'archived'],
  brief_ready: ['planned', 'draft', 'rejected', 'archived'],
  planned: ['ready', 'brief_ready', 'rejected', 'archived'],
  ready: ['scheduled', 'planned', 'rejected', 'archived'],
  scheduled: ['published', 'failed', 'ready'],
  failed: ['planned', 'rejected', 'archived'],
  published: ['archived'],
  rejected: ['draft'],
  archived: [],
};

const CREATED_AT = new Date('2026-07-01T08:00:00.000Z');
const AT = new Date('2026-07-02T10:30:00.000Z');

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    ...createContentItemDraft({
      id: 'item_1',
      accountId: 'acc_1',
      format: 'post',
      title: 'Title',
      brief: 'A brief',
      caption: 'A caption',
      mediaRefs: ['media/1.png'],
      topics: ['cooking'],
      createdAt: CREATED_AT,
      metadata: { source: 'test' },
    }),
    ...overrides,
  };
}

describe('canTransitionContent', () => {
  it.each<[ContentStatus, ContentStatus]>([
    ['draft', 'brief_ready'],
    ['brief_ready', 'planned'],
    ['planned', 'ready'],
    ['ready', 'scheduled'],
    ['scheduled', 'published'],
    ['scheduled', 'failed'],
    ['scheduled', 'ready'],
    ['failed', 'planned'],
    ['published', 'archived'],
    ['rejected', 'draft'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransitionContent(from, to)).toBe(true);
    expect(() => {
      assertContentTransition(from, to);
    }).not.toThrow();
  });

  it.each<[ContentStatus, ContentStatus]>([
    ['draft', 'published'],
    ['draft', 'scheduled'],
    ['ready', 'published'],
    ['published', 'failed'],
    ['archived', 'draft'],
  ])('forbids %s -> %s', (from, to) => {
    expect(canTransitionContent(from, to)).toBe(false);
    expect(() => {
      assertContentTransition(from, to);
    }).toThrow(InvalidContentTransitionError);
  });

  it('allows exactly the transitions of the specification and nothing else', () => {
    for (const from of CONTENT_STATUSES) {
      for (const to of CONTENT_STATUSES) {
        expect(canTransitionContent(from, to), `${from} -> ${to}`).toBe(
          EXPECTED[from].includes(to),
        );
      }
    }
  });

  it('never allows staying in the same status', () => {
    for (const status of CONTENT_STATUSES) {
      expect(canTransitionContent(status, status)).toBe(false);
    }
  });

  it('allows nothing out of archived', () => {
    for (const to of CONTENT_STATUSES) {
      expect(canTransitionContent('archived', to)).toBe(false);
    }
  });

  it('only allows a published item to be archived', () => {
    expect(CONTENT_STATUSES.filter((to) => canTransitionContent('published', to))).toEqual([
      'archived',
    ]);
  });

  it('rejects unknown statuses at runtime', () => {
    const unknown = 'deleted' as unknown as ContentStatus;

    expect(canTransitionContent(unknown, 'draft')).toBe(false);
    expect(canTransitionContent('draft', unknown)).toBe(false);
  });
});

describe('assertContentTransition', () => {
  it('throws an InvalidContentTransitionError that carries both statuses and the issue', () => {
    try {
      assertContentTransition('draft', 'published');
      expect.unreachable('assertContentTransition should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidContentTransitionError);
      const typed = error as InvalidContentTransitionError;
      expect(typed.from).toBe('draft');
      expect(typed.to).toBe('published');
      expect(typed.code).toBe('INVALID_CONTENT_TRANSITION');
      expect(typed.message).toContain('draft -> published');
      expect(typed.issues).toEqual([
        { code: 'invalid_transition', message: 'Transition is not allowed' },
      ]);
    }
  });

  it('is a content validation error, a publisher error and a domain error', () => {
    const error = new InvalidContentTransitionError('draft', 'published');

    expect(error).toBeInstanceOf(ContentValidationError);
    expect(error).toBeInstanceOf(PublisherError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidContentTransitionError');
  });
});

describe('requiresManualConfirmation', () => {
  it('is true for scheduled -> published', () => {
    expect(requiresManualConfirmation('scheduled', 'published')).toBe(true);
  });

  it('is false for every other transition', () => {
    for (const from of CONTENT_STATUSES) {
      for (const to of CONTENT_STATUSES) {
        if (from === 'scheduled' && to === 'published') {
          continue;
        }
        expect(requiresManualConfirmation(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });
});

describe('transitionContentItem', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a new object and does not mutate the original', () => {
    const item = makeItem({ status: 'brief_ready' });
    const snapshot = structuredClone(item);
    Object.freeze(item);
    Object.freeze(item.mediaRefs);
    Object.freeze(item.topics);
    Object.freeze(item.metadata);

    const next = transitionContentItem(item, 'planned', { at: AT, plannedDate: '2026-07-10' });

    expect(next).not.toBe(item);
    expect(item).toEqual(snapshot);
    expect(item.status).toBe('brief_ready');
  });

  it('does not share its collections with the original', () => {
    const item = makeItem({ status: 'brief_ready' });

    const next = transitionContentItem(item, 'planned', { plannedDate: '2026-07-10' });

    expect(next.mediaRefs).toEqual(item.mediaRefs);
    expect(next.mediaRefs).not.toBe(item.mediaRefs);
    expect(next.topics).not.toBe(item.topics);
    expect(next.metadata).not.toBe(item.metadata);
  });

  it('updates status and updatedAt, using the given moment', () => {
    const next = transitionContentItem(makeItem({ status: 'brief_ready' }), 'planned', {
      at: AT,
      plannedDate: '2026-07-10',
    });

    expect(next.status).toBe('planned');
    expect(next.updatedAt).toBe('2026-07-02T10:30:00.000Z');
    expect(next.createdAt).toBe(CREATED_AT.toISOString());
  });

  it('uses the current time when no moment is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T07:06:05.004Z'));

    const next = transitionContentItem(makeItem({ status: 'brief_ready' }), 'planned');

    expect(next.updatedAt).toBe('2026-08-09T07:06:05.004Z');
  });

  it('sets plannedDate when moving to planned', () => {
    const next = transitionContentItem(makeItem({ status: 'brief_ready' }), 'planned', {
      plannedDate: '2026-07-10',
    });

    expect(next.plannedDate).toBe('2026-07-10');
  });

  it('sets scheduledAt when moving to scheduled', () => {
    const next = transitionContentItem(makeItem({ status: 'ready' }), 'scheduled', {
      scheduledAt: '2026-07-10T09:00:00.000Z',
    });

    expect(next.scheduledAt).toBe('2026-07-10T09:00:00.000Z');
  });

  it('sets publishedAt and externalId when moving to published', () => {
    const next = transitionContentItem(makeItem({ status: 'scheduled' }), 'published', {
      publishedAt: '2026-07-10T09:00:05.000Z',
      externalId: 'ext_42',
    });

    expect(next.publishedAt).toBe('2026-07-10T09:00:05.000Z');
    expect(next.externalId).toBe('ext_42');
  });

  it('defaults publishedAt to the moment of the change and leaves externalId empty', () => {
    const next = transitionContentItem(makeItem({ status: 'scheduled' }), 'published', { at: AT });

    expect(next.publishedAt).toBe(AT.toISOString());
    expect(next.externalId).toBeNull();
  });

  it('sets failureReason when moving to failed', () => {
    const next = transitionContentItem(makeItem({ status: 'scheduled' }), 'failed', {
      failureReason: 'media rejected',
    });

    expect(next.failureReason).toBe('media rejected');
  });

  it('keeps the previous value of a field that is not passed', () => {
    const planned = makeItem({
      status: 'brief_ready',
      plannedDate: '2026-07-05',
      scheduledAt: '2026-07-05T09:00:00.000Z',
      externalId: 'old_ext',
      failureReason: 'old reason',
    });

    const next = transitionContentItem(planned, 'planned');

    expect(next.plannedDate).toBe('2026-07-05');
    expect(next.scheduledAt).toBe('2026-07-05T09:00:00.000Z');
    expect(next.externalId).toBe('old_ext');
    expect(next.failureReason).toBe('old reason');
  });

  it('keeps the failure reason as history when an item is planned again', () => {
    const failed = makeItem({ status: 'failed', failureReason: 'media rejected' });

    const next = transitionContentItem(failed, 'planned', { plannedDate: '2026-07-12' });

    expect(next.status).toBe('planned');
    expect(next.failureReason).toBe('media rejected');
    expect(next.plannedDate).toBe('2026-07-12');
  });

  it('keeps scheduledAt when a schedule is cancelled', () => {
    const scheduled = makeItem({ status: 'scheduled', scheduledAt: '2026-07-10T09:00:00.000Z' });

    const next = transitionContentItem(scheduled, 'ready');

    expect(next.status).toBe('ready');
    expect(next.scheduledAt).toBe('2026-07-10T09:00:00.000Z');
  });

  it('applies an option only to the status it belongs to', () => {
    const next = transitionContentItem(makeItem({ status: 'planned' }), 'ready', {
      plannedDate: '2030-01-01',
      scheduledAt: '2030-01-01T00:00:00.000Z',
      externalId: 'ignored',
      failureReason: 'ignored',
    });

    expect(next.plannedDate).toBeNull();
    expect(next.scheduledAt).toBeNull();
    expect(next.externalId).toBeNull();
    expect(next.failureReason).toBeNull();
  });

  it('throws an InvalidContentTransitionError for a forbidden transition', () => {
    expect(() => transitionContentItem(makeItem({ status: 'draft' }), 'published')).toThrow(
      InvalidContentTransitionError,
    );
  });

  it('does not change the item when the transition is forbidden', () => {
    const item = makeItem({ status: 'archived' });
    const snapshot = structuredClone(item);

    expect(() => transitionContentItem(item, 'draft')).toThrow(InvalidContentTransitionError);

    expect(item).toEqual(snapshot);
  });

  it('throws a ValidationError for an invalid moment', () => {
    expect(() =>
      transitionContentItem(makeItem({ status: 'brief_ready' }), 'planned', {
        at: new Date('nope'),
      }),
    ).toThrow(ValidationError);
  });

  it.each([
    ['planned', 'brief_ready', { plannedDate: '2026-02-30' }],
    ['planned', 'brief_ready', { plannedDate: '10.07.2026' }],
    ['scheduled', 'ready', { scheduledAt: '2026-07-10T09:00:00' }],
    ['scheduled', 'ready', { scheduledAt: 'tomorrow' }],
    ['published', 'scheduled', { publishedAt: '2026-07-10' }],
    ['published', 'scheduled', { externalId: '  ' }],
    ['failed', 'scheduled', { failureReason: '' }],
  ] as const)('rejects an invalid value for %s', (to, from, options) => {
    expect(() => transitionContentItem(makeItem({ status: from }), to, options)).toThrow(
      ValidationError,
    );
  });
});
