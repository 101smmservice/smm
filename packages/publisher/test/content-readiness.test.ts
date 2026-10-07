import { describe, expect, it } from 'vitest';

import {
  createContentItemDraft,
  validateContentItem,
  validateContentTransition,
  type ContentItem,
  type ContentStatus,
} from '../src/index.js';

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    ...createContentItemDraft({
      id: 'item_1',
      accountId: 'acc_1',
      format: 'post',
      brief: 'A brief',
      caption: 'A caption',
      topics: ['cooking'],
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
    }),
    ...overrides,
  };
}

function codes(result: { issues: { code: string }[] }): string[] {
  return result.issues.map((issue) => issue.code);
}

describe('validateContentItem', () => {
  it('accepts a well-formed item', () => {
    expect(validateContentItem(makeItem())).toEqual({ valid: true, issues: [] });
  });

  it('accepts an item with every optional field set', () => {
    const item = makeItem({
      status: 'published',
      plannedDate: '2026-07-10',
      scheduledAt: '2026-07-10T09:00:00.000Z',
      publishedAt: '2026-07-10T09:00:05+03:00',
    });

    expect(validateContentItem(item).valid).toBe(true);
  });

  it.each([
    ['id', { id: '' }, 'missing_id'],
    ['id', { id: '   ' }, 'missing_id'],
    ['accountId', { accountId: '' }, 'missing_account_id'],
    ['format', { format: 'reel' as unknown as ContentItem['format'] }, 'invalid_format'],
    ['status', { status: 'deleted' as unknown as ContentStatus }, 'invalid_status'],
    ['createdAt', { createdAt: 'yesterday' }, 'invalid_iso_timestamp'],
    ['updatedAt', { updatedAt: '2026-07-01' }, 'invalid_iso_timestamp'],
    ['plannedDate', { plannedDate: '2026-02-30' }, 'invalid_planned_date'],
    ['plannedDate', { plannedDate: '01.07.2026' }, 'invalid_planned_date'],
    ['scheduledAt', { scheduledAt: '2026-07-10T09:00:00' }, 'invalid_scheduled_at'],
    ['publishedAt', { publishedAt: 'noon' }, 'invalid_iso_timestamp'],
  ])('reports an invalid %s', (field, overrides, code) => {
    const result = validateContentItem(makeItem(overrides));

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code, field });
  });

  it('reports every problem, not only the first', () => {
    const result = validateContentItem(
      makeItem({ id: '', accountId: '', createdAt: 'x', plannedDate: 'y' }),
    );

    expect(codes(result)).toEqual([
      'missing_id',
      'missing_account_id',
      'invalid_iso_timestamp',
      'invalid_planned_date',
    ]);
  });
});

describe('validateContentTransition', () => {
  describe('draft -> brief_ready', () => {
    it('is refused without a brief', () => {
      const result = validateContentTransition(makeItem({ brief: null }), 'brief_ready');

      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(['missing_brief']);
    });

    it('is refused for a blank brief', () => {
      expect(codes(validateContentTransition(makeItem({ brief: '   ' }), 'brief_ready'))).toEqual([
        'missing_brief',
      ]);
    });

    it('is refused without topics', () => {
      const result = validateContentTransition(makeItem({ topics: [] }), 'brief_ready');

      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(['missing_topics']);
    });

    it('is refused when every topic is blank', () => {
      const result = validateContentTransition(makeItem({ topics: ['', '  '] }), 'brief_ready');

      expect(codes(result)).toEqual(['missing_topics']);
    });

    it('is allowed with a brief and at least one topic', () => {
      expect(
        validateContentTransition(makeItem({ topics: ['', 'cooking'] }), 'brief_ready'),
      ).toEqual({ valid: true, issues: [] });
    });

    it('reports both problems at once', () => {
      const result = validateContentTransition(
        makeItem({ brief: null, topics: [] }),
        'brief_ready',
      );

      expect(codes(result)).toEqual(['missing_brief', 'missing_topics']);
    });
  });

  describe('brief_ready -> planned', () => {
    const item = makeItem({ status: 'brief_ready' });

    it('is refused without a plannedDate', () => {
      const result = validateContentTransition(item, 'planned');

      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(['missing_planned_date']);
    });

    it('is allowed with a valid plannedDate in the options', () => {
      expect(validateContentTransition(item, 'planned', { plannedDate: '2026-07-10' }).valid).toBe(
        true,
      );
    });

    it('is allowed when the item already has a plannedDate', () => {
      const planned = makeItem({ status: 'brief_ready', plannedDate: '2026-07-10' });

      expect(validateContentTransition(planned, 'planned').valid).toBe(true);
    });

    it.each(['2026-02-30', '10.07.2026', '2026-7-1', 'soon'])(
      'rejects the invalid date %j',
      (plannedDate) => {
        const result = validateContentTransition(item, 'planned', { plannedDate });

        expect(result.valid).toBe(false);
        expect(codes(result)).toEqual(['invalid_planned_date']);
      },
    );

    it('prefers the option over the stored value', () => {
      const planned = makeItem({ status: 'brief_ready', plannedDate: '2026-07-10' });

      const result = validateContentTransition(planned, 'planned', { plannedDate: 'bad' });

      expect(codes(result)).toEqual(['invalid_planned_date']);
    });
  });

  describe('planned -> ready', () => {
    it('is refused without a caption and without media', () => {
      const item = makeItem({ status: 'planned', caption: null, mediaRefs: [] });

      const result = validateContentTransition(item, 'ready');

      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(['missing_content_asset']);
    });

    it('is refused when the caption and the media references are blank', () => {
      const item = makeItem({ status: 'planned', caption: '  ', mediaRefs: ['', ' '] });

      expect(codes(validateContentTransition(item, 'ready'))).toEqual(['missing_content_asset']);
    });

    it('is allowed with a caption', () => {
      const item = makeItem({ status: 'planned', caption: 'Hello', mediaRefs: [] });

      expect(validateContentTransition(item, 'ready').valid).toBe(true);
    });

    it('is allowed with at least one media reference', () => {
      const item = makeItem({ status: 'planned', caption: null, mediaRefs: ['', 'media/1.png'] });

      expect(validateContentTransition(item, 'ready').valid).toBe(true);
    });
  });

  describe('ready -> scheduled', () => {
    const item = makeItem({ status: 'ready' });

    it('is refused without scheduledAt', () => {
      const result = validateContentTransition(item, 'scheduled');

      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(['missing_scheduled_at']);
    });

    it('is allowed with a valid ISO timestamp', () => {
      expect(
        validateContentTransition(item, 'scheduled', { scheduledAt: '2026-07-10T09:00:00.000Z' })
          .valid,
      ).toBe(true);
    });

    it('is allowed when the item already has scheduledAt', () => {
      const scheduled = makeItem({ status: 'ready', scheduledAt: '2026-07-10T09:00:00.000Z' });

      expect(validateContentTransition(scheduled, 'scheduled').valid).toBe(true);
    });

    it.each(['2026-07-10', '2026-07-10T09:00:00', 'tomorrow', '2026-02-30T09:00:00Z'])(
      'rejects the invalid timestamp %j',
      (scheduledAt) => {
        const result = validateContentTransition(item, 'scheduled', { scheduledAt });

        expect(result.valid).toBe(false);
        expect(codes(result)).toEqual(['invalid_scheduled_at']);
      },
    );
  });

  describe('scheduled -> failed', () => {
    const item = makeItem({ status: 'scheduled' });

    it('is refused without a failureReason', () => {
      const result = validateContentTransition(item, 'failed');

      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(['missing_failure_reason']);
    });

    it('is refused for a blank reason', () => {
      expect(codes(validateContentTransition(item, 'failed', { failureReason: '  ' }))).toEqual([
        'missing_failure_reason',
      ]);
    });

    it('is allowed with a non-empty reason', () => {
      expect(
        validateContentTransition(item, 'failed', { failureReason: 'media rejected' }).valid,
      ).toBe(true);
    });

    it('is allowed when the item already has a reason', () => {
      const withReason = makeItem({ status: 'scheduled', failureReason: 'earlier failure' });

      expect(validateContentTransition(withReason, 'failed').valid).toBe(true);
    });
  });

  describe('transitions without extra requirements', () => {
    it('allows scheduled -> published without an externalId', () => {
      const result = validateContentTransition(makeItem({ status: 'scheduled' }), 'published');

      expect(result).toEqual({ valid: true, issues: [] });
    });

    it('allows scheduled -> ready (cancelling the schedule)', () => {
      expect(validateContentTransition(makeItem({ status: 'scheduled' }), 'ready').valid).toBe(
        true,
      );
    });

    it('allows failed -> planned (planning again after a failure)', () => {
      const failed = makeItem({ status: 'failed', failureReason: 'media rejected' });

      expect(validateContentTransition(failed, 'planned').valid).toBe(true);
    });

    it.each<ContentStatus>(['draft', 'brief_ready', 'planned', 'ready', 'failed'])(
      'allows %s -> rejected and %s -> archived without extra fields',
      (status) => {
        const item = makeItem({ status, brief: null, topics: [], caption: null });

        expect(validateContentTransition(item, 'rejected').valid).toBe(true);
        expect(validateContentTransition(item, 'archived').valid).toBe(true);
      },
    );

    it('allows published -> archived', () => {
      expect(validateContentTransition(makeItem({ status: 'published' }), 'archived').valid).toBe(
        true,
      );
    });
  });

  describe('invalid transitions', () => {
    it('return exactly the invalid_transition issue', () => {
      expect(validateContentTransition(makeItem({ status: 'draft' }), 'published')).toEqual({
        valid: false,
        issues: [{ code: 'invalid_transition', message: 'Transition is not allowed' }],
      });
    });

    it('are reported before any field requirement is looked at', () => {
      const item = makeItem({ status: 'ready', caption: null, mediaRefs: [] });

      expect(codes(validateContentTransition(item, 'published'))).toEqual(['invalid_transition']);
    });

    it('cover moves out of archived and onto the same status', () => {
      expect(validateContentTransition(makeItem({ status: 'archived' }), 'draft').valid).toBe(
        false,
      );
      expect(validateContentTransition(makeItem({ status: 'draft' }), 'draft').valid).toBe(false);
    });

    it('cover an unknown target status', () => {
      const result = validateContentTransition(makeItem(), 'deleted' as unknown as ContentStatus);

      expect(codes(result)).toEqual(['invalid_transition']);
    });
  });

  it('does not mutate the item or the options', () => {
    const item = makeItem({ status: 'brief_ready' });
    const options = { plannedDate: '2026-07-10' };
    const itemSnapshot = structuredClone(item);
    Object.freeze(item);
    Object.freeze(options);

    validateContentTransition(item, 'planned', options);

    expect(item).toEqual(itemSnapshot);
    expect(options).toEqual({ plannedDate: '2026-07-10' });
  });
});
