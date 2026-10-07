import type { Account, LifecycleEvent } from '@persona/core';
import type { ContentItem } from '@persona/publisher';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTestApp,
  createAccount,
  createContent,
  createPersona,
  moveAccount,
  scheduleContent,
  TODAY,
  type ErrorBody,
  type TestClock,
} from './helpers.js';

interface Status {
  running: boolean;
  tickCount: number;
  lastError: string | null;
  publicationsAttempted: number;
  publicationsSucceeded: number;
  publicationsFailed: number;
}

let app: FastifyInstance;
let clock: TestClock;

async function setUp(overrides: Parameters<typeof buildTestApp>[0] = {}): Promise<void> {
  ({ app, clock } = await buildTestApp(overrides));
}

/** Content items made at different moments, so that their order does not depend on their ids. */
async function scheduledContent(accountId: string): Promise<ContentItem> {
  clock.advance(1000);
  const content = await createContent(app, accountId);
  await scheduleContent(app, content.id, TODAY);
  return content;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(async () => {
  await app.close();
  vi.useRealTimers();
});

/** An active account of a persona that is active from 09:00 to 21:00. */
async function activeAccount(): Promise<Account> {
  const persona = await createPersona(app);
  const account = await createAccount(app, { personaId: persona.id });
  return moveAccount(app, account.id, ['onboarding', 'warming', 'active']);
}

/** Runs the simulator through the rest of the simulated day: one tick is one hour. */
async function runDay(): Promise<Status> {
  await app.inject({
    method: 'POST',
    url: '/simulator/start',
    payload: { speed: 3600, maxTicks: 14 },
  });
  for (let i = 0; i < 14; i += 1) {
    await vi.advanceTimersByTimeAsync(1000);
  }
  await vi.advanceTimersByTimeAsync(0);
  return (await app.inject({ method: 'GET', url: '/simulator/status' })).json<Status>();
}

async function getContent(id: string): Promise<ContentItem> {
  return (await app.inject({ method: 'GET', url: `/content/${id}` })).json<ContentItem>();
}

async function events(query = ''): Promise<LifecycleEvent[]> {
  return (await app.inject({ method: 'GET', url: `/events${query}` })).json<LifecycleEvent[]>();
}

/** Publications of content: `post` actions of the simulator that name the content item. */
const publications = (list: LifecycleEvent[]) =>
  list.filter(
    (event) =>
      event.payload.source === 'simulator' &&
      event.payload.action === 'post' &&
      typeof event.payload.contentId === 'string',
  );

describe('publishing content through the service', () => {
  it('publishes content that is scheduled for the simulated day', async () => {
    await setUp();
    const account = await activeAccount();
    const content = await createContent(app, account.id);
    await scheduleContent(app, content.id, TODAY);

    const status = await runDay();

    const published = await getContent(content.id);
    expect(published.status).toBe('published');
    expect(published.externalId).toBe(`sim-post-${content.id}`);
    expect(Date.parse(published.publishedAt ?? '')).toBeGreaterThan(Date.parse(content.createdAt));
    expect(status).toMatchObject({
      running: false,
      lastError: null,
      publicationsAttempted: 1,
      publicationsSucceeded: 1,
      publicationsFailed: 0,
    });
  });

  it('puts the publication into GET /events', async () => {
    await setUp();
    const account = await activeAccount();
    const content = await createContent(app, account.id);
    await scheduleContent(app, content.id, TODAY);

    await runDay();

    const [event, ...others] = publications(await events());
    expect(others).toHaveLength(0);
    expect(event).toMatchObject({
      accountId: account.id,
      type: 'action_performed',
      payload: {
        action: 'post',
        contentId: content.id,
        externalId: `sim-post-${content.id}`,
        source: 'simulator',
      },
    });
    expect(event?.createdAt).toBe((await getContent(content.id)).publishedAt);
    expect(await events('?type=action_performed')).toContainEqual(event);
  });

  it('records a failed publication with its reason when the chance of success is 0', async () => {
    await setUp({ simulatorProbabilities: { publicationSuccess: 0 } });
    const account = await activeAccount();
    const content = await createContent(app, account.id);
    await scheduleContent(app, content.id, TODAY);

    const status = await runDay();

    const failed = await getContent(content.id);
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toBe('simulated_publication_error');
    expect(failed.publishedAt).toBeNull();
    const [event] = publications(await events());
    expect(event).toMatchObject({
      type: 'action_failed',
      payload: { action: 'post', contentId: content.id, reason: 'simulated_publication_error' },
    });
    expect(status).toMatchObject({ publicationsFailed: 1, publicationsSucceeded: 0 });
  });

  it('takes the content off the list of scheduled content', async () => {
    await setUp();
    const account = await activeAccount();
    const content = await createContent(app, account.id);
    await scheduleContent(app, content.id, TODAY);
    const before = await app.inject({ method: 'GET', url: '/content?status=scheduled' });
    expect(before.json<ContentItem[]>().map((item) => item.id)).toEqual([content.id]);

    await runDay();

    const scheduled = await app.inject({ method: 'GET', url: '/content?status=scheduled' });
    const published = await app.inject({ method: 'GET', url: '/content?status=published' });
    expect(scheduled.json<ContentItem[]>()).toEqual([]);
    expect(published.json<ContentItem[]>().map((item) => item.id)).toEqual([content.id]);
  });

  it('handles several items and counts every attempt', async () => {
    await setUp({ simulatorProbabilities: { publicationSuccess: 0.5 } });
    const account = await activeAccount();
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      ids.push((await scheduledContent(account.id)).id);
    }

    const status = await runDay();

    const statuses = await Promise.all(ids.map(async (id) => (await getContent(id)).status));
    expect(statuses.every((value) => value === 'published' || value === 'failed')).toBe(true);
    expect(status.publicationsAttempted).toBe(6);
    expect(status.publicationsSucceeded + status.publicationsFailed).toBe(6);
    expect(status.publicationsSucceeded).toBe(
      statuses.filter((value) => value === 'published').length,
    );
    expect(publications(await events())).toHaveLength(6);
  });

  it('leaves content alone that is planned for another day or not scheduled yet', async () => {
    await setUp();
    const account = await activeAccount();
    const otherDay = await createContent(app, account.id);
    await scheduleContent(app, otherDay.id, '2026-07-20');
    const draft = await createContent(app, account.id);

    const status = await runDay();

    expect((await getContent(otherDay.id)).status).toBe('scheduled');
    expect((await getContent(draft.id)).status).toBe('draft');
    expect(status).toMatchObject({ lastError: null, publicationsAttempted: 0 });
    expect(publications(await events())).toHaveLength(0);
  });

  it('works without any content and without errors', async () => {
    await setUp();
    await activeAccount();

    const status = await runDay();

    expect(status).toMatchObject({
      lastError: null,
      publicationsAttempted: 0,
      publicationsSucceeded: 0,
      publicationsFailed: 0,
    });
    expect(
      (await events()).filter((event) => event.payload.source === 'simulator').length,
    ).toBeGreaterThan(0);
  });

  it('shows the publications in the analytics snapshot', async () => {
    await setUp({ simulatorProbabilities: { publicationSuccess: 0.5 } });
    const account = await activeAccount();
    for (let i = 0; i < 6; i += 1) {
      await scheduledContent(account.id);
    }

    const status = await runDay();

    const snapshot = (await app.inject({ method: 'GET', url: '/analytics/snapshot' })).json<{
      publicationMetrics: { total: number; published: number; failed: number };
    }>();
    expect(snapshot.publicationMetrics).toEqual({
      total: 6,
      published: status.publicationsSucceeded,
      failed: status.publicationsFailed,
    });
  });

  it('gives the same outcomes for the same seed', async () => {
    const run = async () => {
      await setUp({ simulatorProbabilities: { publicationSuccess: 0.5 } });
      const account = await activeAccount();
      const ids: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        ids.push((await scheduledContent(account.id)).id);
      }
      await runDay();
      const statuses = await Promise.all(ids.map(async (id) => (await getContent(id)).status));
      await app.close();
      return statuses;
    };

    const first = await run();
    const second = await run();

    expect(new Set(first).size).toBe(2);
    expect(second).toEqual(first);
  });
});

describe('errors of the simulator with content in play', () => {
  it('still answers 409 for a second start and a stop that has nothing to stop', async () => {
    await setUp();
    await activeAccount();

    expect((await app.inject({ method: 'POST', url: '/simulator/stop' })).statusCode).toBe(409);
    await app.inject({ method: 'POST', url: '/simulator/start' });
    const again = await app.inject({ method: 'POST', url: '/simulator/start' });

    expect(again.statusCode).toBe(409);
    expect(again.json<ErrorBody>().error.code).toBe('simulator_already_running');
  });

  it('does not change what the routes of the simulator answer', async () => {
    await setUp();

    const status = await app.inject({ method: 'GET', url: '/simulator/status' });

    expect(status.statusCode).toBe(200);
    expect(status.json<Status>()).toMatchObject({
      running: false,
      publicationsAttempted: 0,
      publicationsSucceeded: 0,
      publicationsFailed: 0,
    });
  });
});
