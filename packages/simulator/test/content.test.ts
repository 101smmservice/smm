import type { ContentItem } from '@persona/publisher';
import { ContentPipeline, InMemoryContentRepository } from '@persona/publisher';
import { createSeededRandom } from '@persona/persona-engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PortfolioSimulator,
  SIMULATED_EXTERNAL_ID_PREFIX,
  SIMULATED_PUBLICATION_FAILURE_REASON,
  type SimulatorProbabilities,
} from '../src/index.js';
import {
  at,
  DATE,
  FakeBehaviorEngine,
  FakePersonaEngine,
  makeAccount,
  makePersona,
  makePlan,
  MemoryAccounts,
  MemoryEvents,
  MemoryPersonas,
  NEVER,
  SESSION,
  SESSION_ACTIONS,
  START,
} from './helpers.js';

const TICK_MS = 1000;
const NEXT_DATE = '2026-07-02';

interface Rig {
  accounts: MemoryAccounts;
  events: MemoryEvents;
  personaEngine: FakePersonaEngine;
  behaviorEngine: FakeBehaviorEngine;
  pipeline: ContentPipeline;
  simulator: PortfolioSimulator;
}

/**
 * One account with a persona and one session at 09:10 whose first action is at 09:10:00, with a
 * real content pipeline. The simulated time starts at 09:00. Random events are off except what a
 * test turns on; a publication succeeds unless `publicationSuccess` says otherwise.
 */
function rig(
  options: {
    probabilities?: Partial<SimulatorProbabilities>;
    rng?: () => number;
    withPipeline?: boolean;
    sessionActions?: typeof SESSION_ACTIONS;
  } = {},
): Rig {
  const accounts = new MemoryAccounts();
  const personas = new MemoryPersonas();
  const events = new MemoryEvents();
  const personaEngine = new FakePersonaEngine();
  const behaviorEngine = new FakeBehaviorEngine();
  // Every reading of this clock is a second later, so items differ in `createdAt` and `updatedAt`.
  let pipelineTicks = 0;
  const pipeline = new ContentPipeline(new InMemoryContentRepository(), {
    clock: { now: () => new Date(START.getTime() - 3_600_000 + 1000 * pipelineTicks++) },
  });

  void personas.save(makePersona());
  void accounts.save(makeAccount());
  personaEngine.plan(makePlan('account-1', [SESSION]));
  behaviorEngine.sequence('account-1', SESSION.startAt, options.sessionActions ?? SESSION_ACTIONS);

  const simulator = new PortfolioSimulator({
    accounts,
    personas,
    events,
    personaEngine,
    behaviorEngine,
    clock: { now: () => START },
    rng: options.rng ?? (() => 0.5),
    probabilities: { ...NEVER, publicationSuccess: 1, ...options.probabilities },
    ...(options.withPipeline === false ? {} : { contentPipeline: pipeline }),
  });
  return { accounts, events, personaEngine, behaviorEngine, pipeline, simulator };
}

/** Content of `accountId` that has been taken to `scheduled` for `plannedDate`. */
async function scheduled(
  pipeline: ContentPipeline,
  options: { accountId?: string; plannedDate?: string; to?: ContentItem['status'] } = {},
): Promise<ContentItem> {
  const draft = await pipeline.createDraft({
    accountId: options.accountId ?? 'account-1',
    format: 'post',
    brief: 'Seasonal recipe',
    caption: 'Autumn soup',
    topics: ['cooking'],
  });
  const stop = options.to ?? 'scheduled';
  if (draft.status === stop) {
    return draft;
  }
  const plannedDate = options.plannedDate ?? DATE;
  const steps: Parameters<ContentPipeline['transition']>[0][] = [
    { id: draft.id, to: 'brief_ready' },
    { id: draft.id, to: 'planned', plannedDate },
    { id: draft.id, to: 'ready' },
    { id: draft.id, to: 'scheduled', scheduledAt: `${plannedDate}T09:00:00.000Z` },
  ];
  let item = draft;
  for (const step of steps) {
    item = await pipeline.transition(step);
    if (item.status === stop) {
      break;
    }
  }
  return item;
}

async function item(pipeline: ContentPipeline, id: string): Promise<ContentItem> {
  const found = await pipeline.getItem(id);
  if (found === null) {
    throw new Error(`content ${id} is gone`);
  }
  return found;
}

async function runTicks(simulator: PortfolioSimulator, count: number) {
  for (let i = 0; i < count; i += 1) {
    await vi.advanceTimersByTimeAsync(TICK_MS);
    await simulator.whenIdle();
  }
}

let current: PortfolioSimulator | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  current = undefined;
});

afterEach(async () => {
  if (current?.getStatus().running === true) {
    await current.stop();
  }
  vi.useRealTimers();
});

async function startAndRun(rigged: Rig, ticks: number, config?: { speed?: number }) {
  current = rigged.simulator;
  await rigged.simulator.start(config);
  await runTicks(rigged.simulator, ticks);
}

const posts = (events: MemoryEvents) =>
  events.all.filter(
    (event) =>
      (event.type === 'action_performed' || event.type === 'action_failed') &&
      event.payload.action === 'post',
  );

/** Everything but ids, which differ between runs, for comparing runs with each other. */
function shape(events: MemoryEvents) {
  return events.all.map(({ type, payload, createdAt }) => ({ type, payload, createdAt }));
}

describe('without a content pipeline', () => {
  it('works as it did before and leaves scheduled content alone', async () => {
    const withoutPipeline = rig({ withPipeline: false });
    const content = await scheduled(withoutPipeline.pipeline);

    await startAndRun(withoutPipeline, 11);

    expect(withoutPipeline.events.all.map((event) => event.type)).toEqual([
      'session_started',
      'action_performed',
      'action_performed',
      'action_performed',
      'session_ended',
    ]);
    expect((await item(withoutPipeline.pipeline, content.id)).status).toBe('scheduled');
    expect(withoutPipeline.simulator.getStatus()).toMatchObject({
      publicationsAttempted: 0,
      publicationsSucceeded: 0,
      publicationsFailed: 0,
    });
  });
});

describe('with a content pipeline but nothing scheduled', () => {
  it('works without errors and produces the same events as without it', async () => {
    const plain = rig({ withPipeline: false });
    await startAndRun(plain, 11);
    await plain.simulator.stop();

    const withPipeline = rig();
    await startAndRun(withPipeline, 11);

    expect(shape(withPipeline.events)).toEqual(shape(plain.events));
    expect(withPipeline.simulator.getStatus()).toMatchObject({
      lastError: null,
      publicationsAttempted: 0,
    });
  });
});

describe('publishing scheduled content', () => {
  it('tries to publish content that is scheduled for the simulated day', async () => {
    const rigged = rig();
    await scheduled(rigged.pipeline);

    await startAndRun(rigged, 11);

    expect(rigged.simulator.getStatus().publicationsAttempted).toBe(1);
  });

  it('moves the content to published, with the simulated time and a made-up external id', async () => {
    const rigged = rig();
    const content = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 11);

    const published = await item(rigged.pipeline, content.id);
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe(at('09:10:00'));
    expect(published.externalId).toBe(`${SIMULATED_EXTERNAL_ID_PREFIX}${content.id}`);
    expect(published.externalId?.startsWith('sim-post-')).toBe(true);
    expect(rigged.simulator.getStatus()).toMatchObject({
      publicationsAttempted: 1,
      publicationsSucceeded: 1,
      publicationsFailed: 0,
    });
  });

  it('moves the content to failed, with the reason, when the publication fails', async () => {
    const rigged = rig({ probabilities: { publicationSuccess: 0 } });
    const content = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 11);

    const failed = await item(rigged.pipeline, content.id);
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toBe('simulated_publication_error');
    expect(failed.failureReason).toBe(SIMULATED_PUBLICATION_FAILURE_REASON);
    expect(failed.publishedAt).toBeNull();
    expect(failed.externalId).toBeNull();
    expect(rigged.simulator.getStatus()).toMatchObject({
      publicationsAttempted: 1,
      publicationsSucceeded: 0,
      publicationsFailed: 1,
    });
  });

  it('records action_performed with action post when it succeeds', async () => {
    const rigged = rig();
    const content = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 11);

    const [event, ...others] = posts(rigged.events);
    expect(others).toHaveLength(0);
    expect(event?.type).toBe('action_performed');
    expect(event?.accountId).toBe('account-1');
    expect(event?.createdAt).toBe(at('09:10:00'));
    expect(event?.payload).toEqual({
      action: 'post',
      contentId: content.id,
      sessionId: `account-1:${SESSION.startAt}`,
      externalId: `sim-post-${content.id}`,
      source: 'simulator',
    });
  });

  it('records action_failed with action post when it fails', async () => {
    const rigged = rig({ probabilities: { publicationSuccess: 0 } });
    const content = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 11);

    const [event, ...others] = posts(rigged.events);
    expect(others).toHaveLength(0);
    expect(event?.type).toBe('action_failed');
    expect(event?.payload).toEqual({
      action: 'post',
      contentId: content.id,
      sessionId: `account-1:${SESSION.startAt}`,
      reason: 'simulated_publication_error',
      source: 'simulator',
    });
  });

  it('publishes right after the first action of the session', async () => {
    const rigged = rig();
    await scheduled(rigged.pipeline);

    await startAndRun(rigged, 11);

    expect(rigged.events.all.map((event) => [event.type, event.payload.action])).toEqual([
      ['session_started', undefined],
      ['action_performed', 'view'],
      ['action_performed', 'post'],
      ['action_performed', 'like'],
      ['action_performed', 'view'],
      ['session_ended', undefined],
    ]);
  });

  it('does not publish before the session has done its first action', async () => {
    const rigged = rig();
    const content = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 9);

    expect((await item(rigged.pipeline, content.id)).status).toBe('scheduled');
    expect(posts(rigged.events)).toHaveLength(0);
  });

  it('does not publish in a session without actions', async () => {
    const rigged = rig({ sessionActions: [] });
    const content = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 11);

    expect((await item(rigged.pipeline, content.id)).status).toBe('scheduled');
    expect(rigged.simulator.getStatus().publicationsAttempted).toBe(0);
  });

  it('does not publish on a skip day', async () => {
    const rigged = rig();
    rigged.personaEngine.plan(makePlan('account-1', [SESSION], { isSkipDay: true }));
    const content = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 30);

    expect((await item(rigged.pipeline, content.id)).status).toBe('scheduled');
  });

  it('publishes every item that is scheduled for the day', async () => {
    const rigged = rig();
    const first = await scheduled(rigged.pipeline);
    const second = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 11);

    expect((await item(rigged.pipeline, first.id)).status).toBe('published');
    expect((await item(rigged.pipeline, second.id)).status).toBe('published');
    expect(posts(rigged.events)).toHaveLength(2);
    expect(rigged.simulator.getStatus().publicationsSucceeded).toBe(2);
  });
});

describe('what is not published', () => {
  it('does not publish the same content twice, in later ticks or in later sessions', async () => {
    const rigged = rig();
    const later = { startAt: at('09:30:00'), maxDurationMinutes: 30 };
    rigged.personaEngine.plan(makePlan('account-1', [SESSION, later]));
    rigged.behaviorEngine.sequence('account-1', later.startAt, [
      { type: 'view', delayAfterMs: 0, timestamp: later.startAt },
    ]);
    const content = await scheduled(rigged.pipeline);

    await startAndRun(rigged, 60);

    expect(posts(rigged.events)).toHaveLength(1);
    expect(rigged.simulator.getStatus().publicationsAttempted).toBe(1);
    expect((await item(rigged.pipeline, content.id)).status).toBe('published');
  });

  it('does not fail the same content twice either', async () => {
    const rigged = rig({ probabilities: { publicationSuccess: 0 } });
    const later = { startAt: at('09:30:00'), maxDurationMinutes: 30 };
    rigged.personaEngine.plan(makePlan('account-1', [SESSION, later]));
    rigged.behaviorEngine.sequence('account-1', later.startAt, [
      { type: 'view', delayAfterMs: 0, timestamp: later.startAt },
    ]);
    await scheduled(rigged.pipeline);

    await startAndRun(rigged, 60);

    expect(posts(rigged.events)).toHaveLength(1);
    expect(rigged.simulator.getStatus().publicationsFailed).toBe(1);
  });

  it('tries content that could not be moved only once, and goes on', async () => {
    const rigged = rig();
    const later = { startAt: at('09:30:00'), maxDurationMinutes: 30 };
    rigged.personaEngine.plan(makePlan('account-1', [SESSION, later]));
    rigged.behaviorEngine.sequence('account-1', later.startAt, [
      { type: 'view', delayAfterMs: 0, timestamp: later.startAt },
    ]);
    const content = await scheduled(rigged.pipeline);
    const markPublished = vi
      .spyOn(rigged.pipeline, 'markPublished')
      .mockRejectedValue(new Error('storage unavailable'));

    await startAndRun(rigged, 60);

    expect(markPublished).toHaveBeenCalledTimes(1);
    expect((await item(rigged.pipeline, content.id)).status).toBe('scheduled');
    expect(posts(rigged.events)).toHaveLength(0);
    expect(rigged.simulator.getStatus()).toMatchObject({
      running: true,
      lastError: 'storage unavailable',
      publicationsAttempted: 1,
      publicationsSucceeded: 0,
      publicationsFailed: 0,
    });
    expect(rigged.events.ofType('session_ended')).toHaveLength(2);
  });

  it('tries content again that was scheduled anew after it failed', async () => {
    let draw = 0.99;
    const rigged = rig({ probabilities: { publicationSuccess: 0.5 }, rng: () => draw });
    const later = { startAt: at('09:30:00'), maxDurationMinutes: 30 };
    rigged.personaEngine.plan(makePlan('account-1', [SESSION, later]));
    rigged.behaviorEngine.sequence('account-1', later.startAt, [
      { type: 'view', delayAfterMs: 0, timestamp: later.startAt },
    ]);
    const content = await scheduled(rigged.pipeline);
    current = rigged.simulator;
    await rigged.simulator.start();

    await runTicks(rigged.simulator, 11);
    expect((await item(rigged.pipeline, content.id)).status).toBe('failed');

    // Someone plans the item again; the next session may publish it.
    for (const step of [
      { to: 'planned', plannedDate: DATE },
      { to: 'ready' },
      { to: 'scheduled', scheduledAt: at('09:00:00') },
    ] as const) {
      await rigged.pipeline.transition({ id: content.id, ...step });
    }
    draw = 0;
    await runTicks(rigged.simulator, 25);

    expect((await item(rigged.pipeline, content.id)).status).toBe('published');
    expect(rigged.simulator.getStatus()).toMatchObject({
      publicationsAttempted: 2,
      publicationsSucceeded: 1,
      publicationsFailed: 1,
    });
  });

  it('does not publish content that is planned for another day', async () => {
    const rigged = rig();
    const tomorrow = await scheduled(rigged.pipeline, { plannedDate: NEXT_DATE });
    const yesterday = await scheduled(rigged.pipeline, { plannedDate: '2026-06-30' });

    await startAndRun(rigged, 60);

    expect((await item(rigged.pipeline, tomorrow.id)).status).toBe('scheduled');
    expect((await item(rigged.pipeline, yesterday.id)).status).toBe('scheduled');
    expect(posts(rigged.events)).toHaveLength(0);
    expect(rigged.simulator.getStatus()).toMatchObject({
      publicationsAttempted: 0,
      lastError: null,
    });
  });

  it('publishes content of another day once a session of that day comes', async () => {
    const rigged = rig();
    const tomorrow = await scheduled(rigged.pipeline, { plannedDate: NEXT_DATE });
    const nextSession = { startAt: at('10:00:00', NEXT_DATE), maxDurationMinutes: 30 };
    rigged.personaEngine.plan(makePlan('account-1', [nextSession], { date: NEXT_DATE }));
    rigged.behaviorEngine.sequence('account-1', nextSession.startAt, [
      { type: 'view', delayAfterMs: 0, timestamp: nextSession.startAt },
    ]);

    // One tick is an hour: the next day's session is 25 hours after the start.
    await startAndRun(rigged, 26, { speed: 3600 });

    const published = await item(rigged.pipeline, tomorrow.id);
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe(at('10:00:00', NEXT_DATE));
  });

  it.each(['draft', 'brief_ready', 'planned', 'ready'] as const)(
    'does not publish content that is only %s',
    async (status) => {
      const rigged = rig();
      const content = await scheduled(rigged.pipeline, { to: status });
      expect(content.status).toBe(status);

      await startAndRun(rigged, 60);

      expect((await item(rigged.pipeline, content.id)).status).toBe(status);
      expect(posts(rigged.events)).toHaveLength(0);
      expect(rigged.simulator.getStatus()).toMatchObject({
        publicationsAttempted: 0,
        lastError: null,
      });
    },
  );

  it('does not touch content that is already published, failed or archived', async () => {
    const rigged = rig();
    const done = await scheduled(rigged.pipeline);
    await rigged.pipeline.markPublished(done.id, { externalId: 'real-1' });
    const broken = await scheduled(rigged.pipeline);
    await rigged.pipeline.markFailed(broken.id, 'by hand');
    const archived = await scheduled(rigged.pipeline);
    await rigged.pipeline.markPublished(archived.id);
    await rigged.pipeline.transition({ id: archived.id, to: 'archived' });

    await startAndRun(rigged, 60);

    expect(await item(rigged.pipeline, done.id)).toMatchObject({
      status: 'published',
      externalId: 'real-1',
    });
    expect((await item(rigged.pipeline, broken.id)).failureReason).toBe('by hand');
    expect((await item(rigged.pipeline, archived.id)).status).toBe('archived');
    expect(posts(rigged.events)).toHaveLength(0);
    expect(rigged.simulator.getStatus()).toMatchObject({
      publicationsAttempted: 0,
      lastError: null,
    });
  });

  it('does not publish the content of another account', async () => {
    const rigged = rig();
    await rigged.accounts.save(makeAccount({ id: 'account-2' }));
    const foreign = await scheduled(rigged.pipeline, { accountId: 'account-2' });

    await startAndRun(rigged, 60);

    expect((await item(rigged.pipeline, foreign.id)).status).toBe('scheduled');
    expect(posts(rigged.events)).toHaveLength(0);
    expect(rigged.simulator.getStatus()).toMatchObject({
      publicationsAttempted: 0,
      lastError: null,
    });
  });
});

describe('determinism', () => {
  async function run(seed: number): Promise<{ events: unknown[]; statuses: string[] }> {
    const rigged = rig({
      probabilities: { publicationSuccess: 0.5 },
      rng: createSeededRandom(seed),
    });
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      ids.push((await scheduled(rigged.pipeline)).id);
    }
    await startAndRun(rigged, 11);
    await rigged.simulator.stop();
    return {
      // Content ids are random in every run.
      events: JSON.parse(
        ids.reduce(
          (text, id, i) => text.replaceAll(id, `content-${String(i)}`),
          JSON.stringify(shape(rigged.events)),
        ),
      ) as unknown[],
      statuses: await Promise.all(ids.map(async (id) => (await item(rigged.pipeline, id)).status)),
    };
  }

  it('gives the same outcomes for the same rng', async () => {
    const first = await run(3);
    const second = await run(3);

    expect(second).toEqual(first);
  });

  it('succeeds and fails in the shares the chance asks for', async () => {
    const { statuses } = await run(3);

    expect(statuses).toHaveLength(8);
    expect(statuses.every((status) => status === 'published' || status === 'failed')).toBe(true);
    expect(new Set(statuses).size).toBe(2);
  });
});
