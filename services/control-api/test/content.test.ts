import type { ContentItem, ContentPlan } from '@persona/publisher';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  anyUuid,
  buildTestApp,
  createAccount,
  createContent,
  createPersona,
  scheduleContent,
  transitionContent,
  type ErrorBody,
  type TestClock,
} from './helpers.js';

let app: FastifyInstance;
let clock: TestClock;
let accountId: string;

beforeEach(async () => {
  ({ app, clock } = await buildTestApp());
  accountId = (await createAccount(app)).id;
});

afterEach(async () => {
  await app.close();
});

function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url, payload: payload as object });
}

async function getContent(contentId: string): Promise<ContentItem> {
  const response = await app.inject({ method: 'GET', url: `/content/${contentId}` });
  return response.json<ContentItem>();
}

describe('POST /content', () => {
  it('creates a draft', async () => {
    const response = await post('/content', {
      accountId,
      format: 'video',
      title: 'Title',
      brief: 'A brief',
      caption: 'A caption',
      mediaRefs: ['media/1.mp4'],
      topics: ['cooking'],
      cta: 'Subscribe',
      metadata: { source: 'test' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<ContentItem>()).toEqual({
      id: anyUuid(),
      accountId,
      personaId: null,
      format: 'video',
      title: 'Title',
      brief: 'A brief',
      caption: 'A caption',
      mediaRefs: ['media/1.mp4'],
      topics: ['cooking'],
      cta: 'Subscribe',
      status: 'draft',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z',
      plannedDate: null,
      scheduledAt: null,
      publishedAt: null,
      externalId: null,
      failureReason: null,
      metadata: { source: 'test' },
    });
  });

  it('can be created with nothing but an account and a format', async () => {
    const response = await post('/content', { accountId, format: 'story' });

    expect(response.statusCode).toBe(201);
    expect(response.json<ContentItem>()).toMatchObject({
      status: 'draft',
      brief: null,
      mediaRefs: [],
      topics: [],
    });
  });

  it('takes the persona of the account when none is given', async () => {
    const persona = await createPersona(app);
    const withPersona = await createAccount(app, { personaId: persona.id });

    const item = await createContent(app, withPersona.id);

    expect(item.personaId).toBe(persona.id);
  });

  it('uses an explicit persona, or none, instead of the one of the account', async () => {
    const accountPersona = await createPersona(app);
    const other = await createPersona(app, { niche: 'travel' });
    const withPersona = await createAccount(app, { personaId: accountPersona.id });

    const explicit = await createContent(app, withPersona.id, { personaId: other.id });
    const none = await createContent(app, withPersona.id, { personaId: null });

    expect(explicit.personaId).toBe(other.id);
    expect(none.personaId).toBeNull();
  });

  it('answers 400 for a persona that does not exist', async () => {
    const response = await post('/content', { accountId, format: 'post', personaId: 'missing' });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });

  it('answers 404 for an unknown account', async () => {
    const response = await post('/content', { accountId: 'missing', format: 'post' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('not_found');
  });

  it.each([
    ['an unknown format', { format: 'reel' }],
    ['a missing format', {}],
    ['an unknown field', { format: 'post', status: 'published' }],
    ['topics that are not strings', { format: 'post', topics: [1] }],
    ['an empty accountId', { accountId: '', format: 'post' }],
  ])('answers 400 for %s', async (_label, extra) => {
    const response = await post('/content', { accountId, ...extra });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });
});

describe('GET /content/:contentId', () => {
  it('returns the item', async () => {
    const item = await createContent(app, accountId);

    const response = await app.inject({ method: 'GET', url: `/content/${item.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(item);
  });

  it('answers 404 for an unknown item', async () => {
    const response = await app.inject({ method: 'GET', url: '/content/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('not_found');
  });
});

describe('POST /content/:contentId/transition', () => {
  it('walks the full lifecycle draft -> ... -> published', async () => {
    const item = await createContent(app, accountId);

    const steps: [Record<string, unknown>, string][] = [
      [{ to: 'brief_ready' }, 'brief_ready'],
      [{ to: 'planned', plannedDate: '2026-07-10' }, 'planned'],
      [{ to: 'ready' }, 'ready'],
      [{ to: 'scheduled', scheduledAt: '2026-07-10T09:00:00Z' }, 'scheduled'],
      [{ to: 'published', confirm: true, externalId: 'ext_1' }, 'published'],
    ];
    for (const [payload, status] of steps) {
      clock.advance(1000);
      const response = await transitionContent(app, item.id, payload);

      expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
      expect(response.json<ContentItem>().status).toBe(status);
    }

    expect(await getContent(item.id)).toMatchObject({
      status: 'published',
      plannedDate: '2026-07-10',
      scheduledAt: '2026-07-10T09:00:00Z',
      externalId: 'ext_1',
      publishedAt: '2026-07-01T12:00:05.000Z',
      updatedAt: '2026-07-01T12:00:05.000Z',
    });
  });

  it('answers manual_confirmation_required for scheduled -> published without confirm', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);

    const response = await transitionContent(app, item.id, { to: 'published' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('manual_confirmation_required');
    expect(response.json<ErrorBody>().error.details).toEqual([
      { from: 'scheduled', to: 'published' },
    ]);
    expect((await getContent(item.id)).status).toBe('scheduled');
  });

  it('treats confirm: false like a missing confirmation', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);

    const response = await transitionContent(app, item.id, { to: 'published', confirm: false });

    expect(response.json<ErrorBody>().error.code).toBe('manual_confirmation_required');
  });

  it('performs scheduled -> published with confirm: true', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);

    const response = await transitionContent(app, item.id, { to: 'published', confirm: true });

    expect(response.statusCode).toBe(200);
    expect(response.json<ContentItem>().status).toBe('published');
  });

  it('does not ask for confirmation for other transitions', async () => {
    const item = await createContent(app, accountId);

    expect((await transitionContent(app, item.id, { to: 'brief_ready' })).statusCode).toBe(200);
    expect((await transitionContent(app, item.id, { to: 'rejected' })).statusCode).toBe(200);
  });

  it('answers 409 invalid_transition for a transition that is not allowed', async () => {
    const item = await createContent(app, accountId);

    const response = await transitionContent(app, item.id, { to: 'published', confirm: true });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    expect((await getContent(item.id)).status).toBe('draft');
  });

  it('answers 409 domain_error, listing the problems, when the item is not ready', async () => {
    const item = await createContent(app, accountId, { brief: null, topics: [] });

    const response = await transitionContent(app, item.id, { to: 'brief_ready' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('domain_error');
    expect(response.json<ErrorBody>().error.details).toEqual([
      expect.objectContaining({ code: 'missing_brief' }),
      expect.objectContaining({ code: 'missing_topics' }),
    ]);
    expect((await getContent(item.id)).status).toBe('draft');
  });

  it('answers 409 domain_error when a required value was not given', async () => {
    const item = await createContent(app, accountId);
    await transitionContent(app, item.id, { to: 'brief_ready' });

    const response = await transitionContent(app, item.id, { to: 'planned' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.details).toEqual([
      expect.objectContaining({ code: 'missing_planned_date' }),
    ]);
  });

  it('allows planning again after a failure and keeps the reason', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);
    await post(`/content/${item.id}/failed`, { reason: 'media rejected' });

    const response = await transitionContent(app, item.id, {
      to: 'planned',
      plannedDate: '2026-07-12',
    });

    expect(response.json<ContentItem>()).toMatchObject({
      status: 'planned',
      plannedDate: '2026-07-12',
      failureReason: 'media rejected',
    });
  });

  it('answers 404 for an unknown item', async () => {
    const response = await transitionContent(app, 'missing', { to: 'brief_ready' });

    expect(response.statusCode).toBe(404);
  });

  it('checks that the item exists before asking for confirmation', async () => {
    const response = await transitionContent(app, 'missing', { to: 'published' });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ['an unknown status', { to: 'deleted' }],
    ['a missing target', {}],
    ['a plannedDate that is not a date', { to: 'planned', plannedDate: '10.07.2026' }],
    ['a scheduledAt without an offset', { to: 'scheduled', scheduledAt: '2026-07-10T09:00:00' }],
    ['a blank externalId', { to: 'published', externalId: '  ' }],
    ['an unknown field', { to: 'brief_ready', note: 'x' }],
    ['an invalid moment', { to: 'brief_ready', at: 'now' }],
  ])('answers 400 for %s', async (_label, payload) => {
    const item = await createContent(app, accountId);

    const response = await transitionContent(app, item.id, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });
});

describe('POST /content/:contentId/published', () => {
  it('confirms the publication of a scheduled item', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);

    const response = await post(`/content/${item.id}/published`, {
      confirm: true,
      at: '2026-07-10T09:00:30Z',
      externalId: 'ext_9',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ContentItem>()).toMatchObject({
      status: 'published',
      publishedAt: '2026-07-10T09:00:30.000Z',
      externalId: 'ext_9',
    });
  });

  it('works with nothing but the confirmation', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);

    const response = await post(`/content/${item.id}/published`, { confirm: true });

    expect(response.json<ContentItem>()).toMatchObject({
      status: 'published',
      publishedAt: '2026-07-01T12:00:00.000Z',
      externalId: null,
    });
  });

  it.each([{}, { confirm: false }, { externalId: 'ext_1' }])(
    'answers manual_confirmation_required for %j',
    async (payload) => {
      const item = await createContent(app, accountId);
      await scheduleContent(app, item.id);

      const response = await post(`/content/${item.id}/published`, payload);

      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error.code).toBe('manual_confirmation_required');
      expect((await getContent(item.id)).status).toBe('scheduled');
    },
  );

  it('answers manual_confirmation_required when no body is sent at all', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);

    const response = await app.inject({ method: 'POST', url: `/content/${item.id}/published` });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('manual_confirmation_required');
  });

  it('answers 409 invalid_transition for an item that is not scheduled', async () => {
    const item = await createContent(app, accountId);

    const response = await post(`/content/${item.id}/published`, { confirm: true });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    expect((await getContent(item.id)).status).toBe('draft');
  });

  it('answers 404 for an unknown item and 400 for an unknown field', async () => {
    expect((await post('/content/missing/published', { confirm: true })).statusCode).toBe(404);

    const item = await createContent(app, accountId);
    expect(
      (await post(`/content/${item.id}/published`, { confirm: true, to: 'x' })).statusCode,
    ).toBe(400);
  });
});

describe('POST /content/:contentId/failed', () => {
  it('records a failure of a scheduled item together with the reason', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);

    const response = await post(`/content/${item.id}/failed`, {
      reason: '  media rejected  ',
      at: '2026-07-10T09:05:00Z',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ContentItem>()).toMatchObject({
      status: 'failed',
      failureReason: 'media rejected',
      updatedAt: '2026-07-10T09:05:00.000Z',
    });
  });

  it.each(['draft', 'brief_ready', 'planned', 'ready'] as const)(
    'answers 409 invalid_transition for an item in the %s status',
    async (status) => {
      const item = await createContent(app, accountId);
      const path: Record<string, unknown>[] = [
        { to: 'brief_ready' },
        { to: 'planned', plannedDate: '2026-07-10' },
        { to: 'ready' },
      ];
      const stepsToTake = ['draft', 'brief_ready', 'planned', 'ready'].indexOf(status);
      for (const payload of path.slice(0, stepsToTake)) {
        await transitionContent(app, item.id, payload);
      }

      const response = await post(`/content/${item.id}/failed`, { reason: 'media rejected' });

      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    },
  );

  it('answers 409 invalid_transition for a published item', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id);
    await post(`/content/${item.id}/published`, { confirm: true });

    const response = await post(`/content/${item.id}/failed`, { reason: 'too late' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
  });

  it.each([{}, { reason: '' }, { reason: '   ' }, { reason: 5 }, { reason: 'x', note: 'y' }])(
    'answers 400 for the body %j',
    async (payload) => {
      const item = await createContent(app, accountId);
      await scheduleContent(app, item.id);

      const response = await post(`/content/${item.id}/failed`, payload);

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe('validation_error');
      expect((await getContent(item.id)).status).toBe('scheduled');
    },
  );

  it('answers 404 for an unknown item', async () => {
    expect((await post('/content/missing/failed', { reason: 'x' })).statusCode).toBe(404);
  });
});

describe('GET /accounts/:accountId/content-plan', () => {
  it('returns an empty plan for a date without content', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}/content-plan?date=2026-07-10`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ContentPlan>()).toEqual({
      accountId,
      date: '2026-07-10',
      itemIds: [],
      counts: {
        draft: 0,
        brief_ready: 0,
        planned: 0,
        ready: 0,
        scheduled: 0,
        published: 0,
        failed: 0,
        rejected: 0,
        archived: 0,
      },
      isReady: false,
    });
  });

  it('counts the items planned for the date', async () => {
    const scheduled = await createContent(app, accountId);
    await scheduleContent(app, scheduled.id, '2026-07-10');
    const ready = await createContent(app, accountId);
    await transitionContent(app, ready.id, { to: 'brief_ready' });
    await transitionContent(app, ready.id, { to: 'planned', plannedDate: '2026-07-10' });
    await transitionContent(app, ready.id, { to: 'ready' });
    const elsewhere = await createContent(app, accountId);
    await scheduleContent(app, elsewhere.id, '2026-07-11');
    const otherAccount = await createAccount(app);
    const foreign = await createContent(app, otherAccount.id);
    await scheduleContent(app, foreign.id, '2026-07-10');

    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}/content-plan?date=2026-07-10`,
    });
    const plan = response.json<ContentPlan>();

    expect([...plan.itemIds].sort()).toEqual([scheduled.id, ready.id].sort());
    expect(plan.counts).toMatchObject({ scheduled: 1, ready: 1, published: 0 });
    expect(plan.isReady).toBe(true);
  });

  it('is not ready once an item failed', async () => {
    const item = await createContent(app, accountId);
    await scheduleContent(app, item.id, '2026-07-10');
    await post(`/content/${item.id}/failed`, { reason: 'media rejected' });

    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}/content-plan?date=2026-07-10`,
    });

    expect(response.json<ContentPlan>()).toMatchObject({ isReady: false, counts: { failed: 1 } });
  });

  it.each(['10.07.2026', '2026-7-10', '2026-02-30', ''])(
    'answers 400 for the date %j',
    async (date) => {
      const response = await app.inject({
        method: 'GET',
        url: `/accounts/${accountId}/content-plan?date=${date}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    },
  );

  it('answers 400 for a missing date and 404 for an unknown account', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/accounts/${accountId}/content-plan` })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/accounts/missing/content-plan?date=2026-07-10' }))
        .statusCode,
    ).toBe(404);
  });
});

describe('GET /content', () => {
  function list(query = '') {
    return app.inject({ method: 'GET', url: `/content${query}` });
  }

  it('answers 200 with an empty array when there is no content', async () => {
    const response = await list();

    expect(response.statusCode).toBe(200);
    expect(response.json<ContentItem[]>()).toEqual([]);
  });

  it('answers 200 with an array of content items', async () => {
    const item = await createContent(app, accountId);

    const response = await list();

    expect(response.statusCode).toBe(200);
    expect(response.json<ContentItem[]>()).toEqual([item]);
  });

  it('lists the content of every account, oldest first', async () => {
    const otherAccount = await createAccount(app);
    const first = await createContent(app, accountId);
    clock.advance(1000);
    const second = await createContent(app, otherAccount.id);
    clock.advance(1000);
    const third = await createContent(app, accountId);

    const items = (await list()).json<ContentItem[]>();

    expect(items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
  });

  it('lists every item when they share a creation time, in a stable order', async () => {
    const created = [
      await createContent(app, accountId),
      await createContent(app, accountId),
      await createContent(app, accountId),
    ];

    const items = (await list()).json<ContentItem[]>();

    expect(items.map((item) => item.id).sort()).toEqual(created.map((item) => item.id).sort());
    expect((await list()).json<ContentItem[]>()).toEqual(items);
  });

  it('filters by account', async () => {
    const otherAccount = await createAccount(app);
    const mine = await createContent(app, accountId);
    await createContent(app, otherAccount.id);

    const items = (await list(`?accountId=${accountId}`)).json<ContentItem[]>();

    expect(items.map((item) => item.id)).toEqual([mine.id]);
  });

  it('filters by status', async () => {
    const draft = await createContent(app, accountId);
    const scheduled = await createContent(app, accountId);
    await scheduleContent(app, scheduled.id);

    const drafts = (await list('?status=draft')).json<ContentItem[]>();
    const scheduledItems = (await list('?status=scheduled')).json<ContentItem[]>();

    expect(drafts.map((item) => item.id)).toEqual([draft.id]);
    expect(scheduledItems.map((item) => item.id)).toEqual([scheduled.id]);
    expect((await list('?status=published')).json<ContentItem[]>()).toEqual([]);
  });

  it('combines the filters', async () => {
    const otherAccount = await createAccount(app);
    const target = await createContent(app, accountId);
    await createContent(app, otherAccount.id);
    const moved = await createContent(app, accountId);
    await transitionContent(app, moved.id, { to: 'brief_ready' });

    const items = (await list(`?accountId=${accountId}&status=draft`)).json<ContentItem[]>();

    expect(items.map((item) => item.id)).toEqual([target.id]);
  });

  it('answers an empty array for an account without content', async () => {
    const response = await list('?accountId=missing');

    expect(response.statusCode).toBe(200);
    expect(response.json<ContentItem[]>()).toEqual([]);
  });

  it('answers 400 for an unknown status', async () => {
    const response = await list('?status=archived-forever');

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });

  it('answers 400 for an empty account id', async () => {
    const response = await list('?accountId=');

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });

  it('answers 400 for an unknown query parameter', async () => {
    const response = await list('?limit=5');

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });
});
