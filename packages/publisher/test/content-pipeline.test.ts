import { ValidationError } from '@persona/core';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ContentNotFoundError,
  ContentPipeline,
  ContentValidationError,
  createFixedClock,
  createSystemClock,
  InMemoryContentRepository,
  InvalidContentTransitionError,
  type ContentItem,
  type ContentStatus,
} from '../src/index.js';

const NOW = new Date('2026-07-01T08:00:00.000Z');
const PLANNED_DATE = '2026-07-10';
const SCHEDULED_AT = '2026-07-10T09:00:00.000Z';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

let repository: InMemoryContentRepository;
let pipeline: ContentPipeline;

beforeEach(() => {
  repository = new InMemoryContentRepository();
  pipeline = new ContentPipeline(repository, { clock: createFixedClock(NOW) });
});

function newDraft(accountId = 'acc_1'): Promise<ContentItem> {
  return pipeline.createDraft({
    accountId,
    format: 'post',
    title: 'Title',
    brief: 'A brief',
    caption: 'A caption',
    topics: ['cooking'],
  });
}

/** Walks a new draft along the happy path until it reaches `target`. */
async function itemIn(
  target: Extract<
    ContentStatus,
    | 'draft'
    | 'brief_ready'
    | 'planned'
    | 'ready'
    | 'scheduled'
    | 'published'
    | 'failed'
    | 'rejected'
  >,
  options: { accountId?: string; plannedDate?: string } = {},
): Promise<ContentItem> {
  const draft = await newDraft(options.accountId);
  const { id } = draft;
  const plannedDate = options.plannedDate ?? PLANNED_DATE;

  const steps: Record<typeof target, () => Promise<ContentItem>> = {
    draft: () => Promise.resolve(draft),
    rejected: () => pipeline.transition({ id, to: 'rejected' }),
    brief_ready: () => pipeline.transition({ id, to: 'brief_ready' }),
    planned: async () => {
      await pipeline.transition({ id, to: 'brief_ready' });
      return pipeline.transition({ id, to: 'planned', plannedDate });
    },
    ready: async () => {
      await steps.planned();
      return pipeline.transition({ id, to: 'ready' });
    },
    scheduled: async () => {
      await steps.ready();
      return pipeline.transition({ id, to: 'scheduled', scheduledAt: SCHEDULED_AT });
    },
    published: async () => {
      await steps.scheduled();
      return pipeline.markPublished(id);
    },
    failed: async () => {
      await steps.scheduled();
      return pipeline.markFailed(id, 'media rejected');
    },
  };
  return steps[target]();
}

describe('ContentPipeline.createDraft', () => {
  it('creates an item in the draft status', async () => {
    const item = await newDraft();

    expect(item.status).toBe('draft');
    expect(item.accountId).toBe('acc_1');
    expect(item.format).toBe('post');
    expect(item.title).toBe('Title');
    expect(item.topics).toEqual(['cooking']);
  });

  it('generates a unique id', async () => {
    const first = await newDraft();
    const second = await newDraft();

    expect(first.id).toMatch(UUID_PATTERN);
    expect(second.id).toMatch(UUID_PATTERN);
    expect(first.id).not.toBe(second.id);
  });

  it('takes the creation time from the clock', async () => {
    const item = await newDraft();

    expect(item.createdAt).toBe('2026-07-01T08:00:00.000Z');
    expect(item.updatedAt).toBe('2026-07-01T08:00:00.000Z');
  });

  it('stores the item in the repository', async () => {
    const item = await newDraft();

    expect(await repository.getById(item.id)).toEqual(item);
  });

  it.each(['', '   '])('throws a ValidationError for the blank accountId %j', async (accountId) => {
    await expect(pipeline.createDraft({ accountId, format: 'post' })).rejects.toThrow(
      ValidationError,
    );
    expect(await repository.findByAccountId(accountId)).toEqual([]);
  });

  it('does not keep references to or change the input', async () => {
    const input = Object.freeze({
      accountId: 'acc_1',
      format: 'post' as const,
      mediaRefs: Object.freeze(['media/1.png']) as unknown as string[],
      topics: Object.freeze(['cooking']) as unknown as string[],
      metadata: Object.freeze({ source: 'test' }),
    });

    const item = await pipeline.createDraft(input);

    expect(input.mediaRefs).toEqual(['media/1.png']);
    expect(item.mediaRefs).not.toBe(input.mediaRefs);
    expect(item.topics).not.toBe(input.topics);
  });
});

describe('ContentPipeline.getItem', () => {
  it('returns a stored item', async () => {
    const item = await newDraft();

    expect(await pipeline.getItem(item.id)).toEqual(item);
  });

  it('returns null when the item is not found', async () => {
    expect(await pipeline.getItem('missing')).toBeNull();
  });
});

describe('ContentPipeline.transition', () => {
  it('throws a ContentNotFoundError for an unknown item', async () => {
    const attempt = pipeline.transition({ id: 'missing', to: 'brief_ready' });

    await expect(attempt).rejects.toThrow(ContentNotFoundError);
    await expect(attempt).rejects.toMatchObject({ contentId: 'missing' });
  });

  it('throws a ContentValidationError for a forbidden transition', async () => {
    const item = await newDraft();

    const attempt = pipeline.transition({ id: item.id, to: 'published' });

    await expect(attempt).rejects.toThrow(ContentValidationError);
    await expect(attempt).rejects.toThrow(InvalidContentTransitionError);
    await expect(attempt).rejects.toMatchObject({
      issues: [{ code: 'invalid_transition', message: 'Transition is not allowed' }],
    });
    expect((await pipeline.getItem(item.id))?.status).toBe('draft');
  });

  it('throws a ContentValidationError listing every problem when the item is not ready', async () => {
    const draft = await pipeline.createDraft({ accountId: 'acc_1', format: 'post' });

    const attempt = pipeline.transition({ id: draft.id, to: 'brief_ready' });

    await expect(attempt).rejects.toThrow(ContentValidationError);
    await expect(attempt).rejects.toMatchObject({
      issues: [{ code: 'missing_brief' }, { code: 'missing_topics' }],
    });
    expect((await pipeline.getItem(draft.id))?.status).toBe('draft');
  });

  it('does not treat a missing requirement as an invalid transition', async () => {
    const draft = await pipeline.createDraft({ accountId: 'acc_1', format: 'post' });

    const error = await pipeline
      .transition({ id: draft.id, to: 'brief_ready' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ContentValidationError);
    expect(error).not.toBeInstanceOf(InvalidContentTransitionError);
  });

  it('takes the moment of the change from the clock, or from the input', async () => {
    const item = await newDraft();
    const pipelineLater = new ContentPipeline(repository, {
      clock: createFixedClock(new Date('2026-07-05T00:00:00.000Z')),
    });

    const byClock = await pipelineLater.transition({ id: item.id, to: 'brief_ready' });
    const byInput = await pipelineLater.transition({
      id: item.id,
      to: 'planned',
      plannedDate: PLANNED_DATE,
      at: new Date('2026-07-06T12:00:00.000Z'),
    });

    expect(byClock.updatedAt).toBe('2026-07-05T00:00:00.000Z');
    expect(byInput.updatedAt).toBe('2026-07-06T12:00:00.000Z');
  });

  it('saves the new item and returns what was saved', async () => {
    const item = await newDraft();

    const next = await pipeline.transition({ id: item.id, to: 'brief_ready' });

    expect(next.status).toBe('brief_ready');
    expect(await repository.getById(item.id)).toEqual(next);
  });

  it('does not mutate the earlier state or the input', async () => {
    const item = await newDraft();
    const input = Object.freeze({ id: item.id, to: 'brief_ready' as const });

    await pipeline.transition(input);

    expect(input).toEqual({ id: item.id, to: 'brief_ready' });
    expect(item.status).toBe('draft');
  });

  it('walks the full lifecycle draft -> ... -> published', async () => {
    const item = await newDraft();
    const { id } = item;

    const briefReady = await pipeline.transition({ id, to: 'brief_ready' });
    const planned = await pipeline.transition({ id, to: 'planned', plannedDate: PLANNED_DATE });
    const ready = await pipeline.transition({ id, to: 'ready' });
    const scheduled = await pipeline.transition({ id, to: 'scheduled', scheduledAt: SCHEDULED_AT });
    const published = await pipeline.transition({ id, to: 'published', externalId: 'ext_1' });

    expect([briefReady, planned, ready, scheduled, published].map((step) => step.status)).toEqual([
      'brief_ready',
      'planned',
      'ready',
      'scheduled',
      'published',
    ]);
    expect(published).toMatchObject({
      plannedDate: PLANNED_DATE,
      scheduledAt: SCHEDULED_AT,
      publishedAt: '2026-07-01T08:00:00.000Z',
      externalId: 'ext_1',
    });
  });

  it('allows planning again after a failure', async () => {
    const failed = await itemIn('failed');

    const replanned = await pipeline.transition({
      id: failed.id,
      to: 'planned',
      plannedDate: '2026-07-12',
    });

    expect(replanned.status).toBe('planned');
    expect(replanned.plannedDate).toBe('2026-07-12');
    expect(replanned.failureReason).toBe('media rejected');
  });

  it('allows cancelling a schedule', async () => {
    const scheduled = await itemIn('scheduled');

    const cancelled = await pipeline.transition({ id: scheduled.id, to: 'ready' });

    expect(cancelled.status).toBe('ready');
  });

  it('lets a rejected item go back to draft', async () => {
    const rejected = await itemIn('rejected');

    expect((await pipeline.transition({ id: rejected.id, to: 'draft' })).status).toBe('draft');
  });

  it('requires a plannedDate to plan an item', async () => {
    const item = await itemIn('brief_ready');

    await expect(pipeline.transition({ id: item.id, to: 'planned' })).rejects.toMatchObject({
      issues: [{ code: 'missing_planned_date' }],
    });
  });
});

describe('ContentPipeline.markPublished', () => {
  it('confirms the publication of a scheduled item', async () => {
    const scheduled = await itemIn('scheduled');

    const published = await pipeline.markPublished(scheduled.id, {
      at: new Date('2026-07-10T09:00:30.000Z'),
      externalId: 'ext_9',
    });

    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe('2026-07-10T09:00:30.000Z');
    expect(published.externalId).toBe('ext_9');
    expect(await repository.getById(scheduled.id)).toEqual(published);
  });

  it('works without an externalId and defaults the time to the clock', async () => {
    const scheduled = await itemIn('scheduled');

    const published = await pipeline.markPublished(scheduled.id);

    expect(published.externalId).toBeNull();
    expect(published.publishedAt).toBe('2026-07-01T08:00:00.000Z');
  });

  it.each(['draft', 'brief_ready', 'planned', 'ready', 'published', 'failed', 'rejected'] as const)(
    'refuses an item in the %s status',
    async (status) => {
      const item = await itemIn(status);

      await expect(pipeline.markPublished(item.id)).rejects.toThrow(InvalidContentTransitionError);
      expect((await pipeline.getItem(item.id))?.status).toBe(status);
    },
  );

  it('throws a ContentNotFoundError for an unknown item', async () => {
    await expect(pipeline.markPublished('missing')).rejects.toThrow(ContentNotFoundError);
  });
});

describe('ContentPipeline.markFailed', () => {
  it('records the failure of a scheduled item together with the reason', async () => {
    const scheduled = await itemIn('scheduled');

    const failed = await pipeline.markFailed(scheduled.id, 'media rejected', {
      at: new Date('2026-07-10T09:05:00.000Z'),
    });

    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toBe('media rejected');
    expect(failed.updatedAt).toBe('2026-07-10T09:05:00.000Z');
    expect((await repository.getById(scheduled.id))?.failureReason).toBe('media rejected');
  });

  it.each(['draft', 'brief_ready', 'planned', 'ready', 'published', 'failed', 'rejected'] as const)(
    'refuses an item in the %s status',
    async (status) => {
      const item = await itemIn(status);

      await expect(pipeline.markFailed(item.id, 'reason')).rejects.toThrow(
        InvalidContentTransitionError,
      );
    },
  );

  it('requires a non-empty reason', async () => {
    const scheduled = await itemIn('scheduled');

    await expect(pipeline.markFailed(scheduled.id, '  ')).rejects.toMatchObject({
      issues: [{ code: 'missing_failure_reason' }],
    });
    expect((await pipeline.getItem(scheduled.id))?.status).toBe('scheduled');
  });
});

describe('ContentPipeline.planForDate', () => {
  const EMPTY_COUNTS = {
    draft: 0,
    brief_ready: 0,
    planned: 0,
    ready: 0,
    scheduled: 0,
    published: 0,
    failed: 0,
    rejected: 0,
    archived: 0,
  };

  it('returns an empty plan for a date without items', async () => {
    expect(await pipeline.planForDate('acc_1', '2026-07-10')).toEqual({
      accountId: 'acc_1',
      date: '2026-07-10',
      itemIds: [],
      counts: EMPTY_COUNTS,
      isReady: false,
    });
  });

  it('counts the items per status and lists their ids', async () => {
    const planned = await itemIn('planned');
    const ready = await itemIn('ready');
    const scheduled = await itemIn('scheduled');
    const published = await itemIn('published');

    const plan = await pipeline.planForDate('acc_1', PLANNED_DATE);

    expect(plan.counts).toEqual({
      ...EMPTY_COUNTS,
      planned: 1,
      ready: 1,
      scheduled: 1,
      published: 1,
    });
    expect([...plan.itemIds].sort()).toEqual(
      [planned.id, ready.id, scheduled.id, published.id].sort(),
    );
  });

  it('only includes items of the account that are planned for the date', async () => {
    const mine = await itemIn('ready');
    await itemIn('ready', { plannedDate: '2026-07-11' });
    await itemIn('ready', { accountId: 'acc_2' });
    await itemIn('brief_ready');
    await newDraft();

    const plan = await pipeline.planForDate('acc_1', PLANNED_DATE);

    expect(plan.itemIds).toEqual([mine.id]);
    expect(plan.counts.ready).toBe(1);
  });

  it('sorts item ids by createdAt, then by id', async () => {
    const early = new ContentPipeline(repository, {
      clock: createFixedClock(new Date('2026-06-01T00:00:00.000Z')),
    });
    const late = new ContentPipeline(repository, {
      clock: createFixedClock(new Date('2026-08-01T00:00:00.000Z')),
    });
    const ids: string[] = [];
    for (const source of [late, early, late, early]) {
      const draft = await source.createDraft({
        accountId: 'acc_1',
        format: 'post',
        brief: 'brief',
        topics: ['topic'],
      });
      await source.transition({ id: draft.id, to: 'brief_ready' });
      await source.transition({ id: draft.id, to: 'planned', plannedDate: PLANNED_DATE });
      ids.push(draft.id);
    }
    const created = await Promise.all(ids.map((id) => repository.getById(id)));
    const expected = created
      .filter((item): item is ContentItem => item !== null)
      .sort((a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id))
      .map((item) => item.id);

    const plan = await pipeline.planForDate('acc_1', PLANNED_DATE);

    expect(plan.itemIds).toEqual(expected);
  });

  it.each(['ready', 'scheduled', 'published'] as const)(
    'is ready when there is an item in the %s status and none failed',
    async (status) => {
      await itemIn(status);
      await itemIn('planned');

      expect((await pipeline.planForDate('acc_1', PLANNED_DATE)).isReady).toBe(true);
    },
  );

  it('is not ready when an item failed, even next to ready ones', async () => {
    await itemIn('ready');
    await itemIn('failed');

    const plan = await pipeline.planForDate('acc_1', PLANNED_DATE);

    expect(plan.counts.failed).toBe(1);
    expect(plan.isReady).toBe(false);
  });

  it('is not ready while nothing has reached the ready status', async () => {
    await itemIn('planned');

    expect((await pipeline.planForDate('acc_1', PLANNED_DATE)).isReady).toBe(false);
  });

  it('is ready again once the failed item is planned again and reaches ready', async () => {
    await itemIn('ready');
    const failed = await itemIn('failed');
    await pipeline.transition({ id: failed.id, to: 'planned' });

    expect((await pipeline.planForDate('acc_1', PLANNED_DATE)).isReady).toBe(true);
  });

  it.each(['2026-7-10', '10.07.2026', '2026-02-30', '', 'today'])(
    'throws a ValidationError for the invalid date %j',
    async (date) => {
      await expect(pipeline.planForDate('acc_1', date)).rejects.toThrow(ValidationError);
    },
  );

  it('throws a ValidationError for a blank accountId', async () => {
    await expect(pipeline.planForDate('', PLANNED_DATE)).rejects.toThrow(ValidationError);
  });
});

describe('clocks', () => {
  it('createFixedClock always returns the same moment, as a fresh Date', () => {
    const clock = createFixedClock(NOW);

    const first = clock.now();
    first.setUTCFullYear(1999);

    expect(clock.now().toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(clock.now()).not.toBe(clock.now());
  });

  it('createFixedClock rejects an invalid date', () => {
    expect(() => createFixedClock(new Date('nope'))).toThrow(ValidationError);
  });

  it('createSystemClock follows the real time', () => {
    const before = Date.now();
    const now = createSystemClock().now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('a pipeline without options uses the system clock', async () => {
    const before = Date.now();
    const item = await new ContentPipeline(new InMemoryContentRepository()).createDraft({
      accountId: 'acc_1',
      format: 'post',
    });

    expect(Date.parse(item.createdAt)).toBeGreaterThanOrEqual(before);
  });
});
