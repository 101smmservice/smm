import type { Account, LifecycleEvent } from '@persona/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTestApp,
  createAccount,
  createPersona,
  FIXED_NOW,
  moveAccount,
  type ErrorBody,
  type TestApp,
} from './helpers.js';

interface Status {
  running: boolean;
  simulatedTime: string | null;
  tickCount: number;
  speed: number;
  tickIntervalMs: number;
  eventsGenerated: number;
  lastError: string | null;
}

let app: FastifyInstance;

async function setUp(overrides: Parameters<typeof buildTestApp>[0] = {}): Promise<TestApp> {
  const built = await buildTestApp(overrides);
  app = built.app;
  return built;
}

beforeEach(() => {
  // Only the interval of the simulator is controlled; everything else keeps running normally.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(async () => {
  await app.close();
  vi.useRealTimers();
});

function getStatus() {
  return app.inject({ method: 'GET', url: '/simulator/status' });
}

function start(payload?: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/simulator/start', payload });
}

function stop(payload?: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/simulator/stop', payload });
}

/** Lets `count` ticks of `intervalMs` pass. */
async function runTicks(count: number, intervalMs = 1000) {
  for (let i = 0; i < count; i += 1) {
    await vi.advanceTimersByTimeAsync(intervalMs);
  }
  await vi.advanceTimersByTimeAsync(0);
}

async function listEvents(query = ''): Promise<LifecycleEvent[]> {
  return (await app.inject({ method: 'GET', url: `/events${query}` })).json<LifecycleEvent[]>();
}

const bySimulator = (event: LifecycleEvent) => event.payload.source === 'simulator';

describe('GET /simulator/status', () => {
  it('reports a simulator that has not been started', async () => {
    await setUp();

    const response = await getStatus();

    expect(response.statusCode).toBe(200);
    expect(response.json<Status>()).toEqual({
      running: false,
      simulatedTime: null,
      tickCount: 0,
      speed: 60,
      tickIntervalMs: 1000,
      eventsGenerated: 0,
      lastError: null,
    });
  });
});

describe('POST /simulator/start', () => {
  it('starts the simulator with the defaults when there is no body', async () => {
    await setUp();

    const response = await start();

    expect(response.statusCode).toBe(200);
    expect(response.json<Status>()).toMatchObject({
      running: true,
      simulatedTime: FIXED_NOW.toISOString(),
      tickCount: 0,
      speed: 60,
      tickIntervalMs: 1000,
    });
    expect((await getStatus()).json<Status>().running).toBe(true);
  });

  it('starts the simulator with an empty object', async () => {
    await setUp();

    expect((await start({})).statusCode).toBe(200);
  });

  it('uses the parameters it is given', async () => {
    await setUp();

    const response = await start({ speed: 120, tickIntervalMs: 500, maxTicks: 10 });

    expect(response.statusCode).toBe(200);
    expect(response.json<Status>()).toMatchObject({
      running: true,
      speed: 120,
      tickIntervalMs: 500,
    });
  });

  it('answers 409 simulator_already_running when it is already running', async () => {
    await setUp();
    await start();

    const response = await start();

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('simulator_already_running');
    expect((await getStatus()).json<Status>().running).toBe(true);
  });

  it('can be started again after it was stopped', async () => {
    await setUp();
    await start();
    await stop();

    const response = await start({ speed: 30 });

    expect(response.statusCode).toBe(200);
    expect(response.json<Status>()).toMatchObject({ running: true, speed: 30, tickCount: 0 });
  });

  it.each([
    ['a speed of 0', { speed: 0 }],
    ['a negative speed', { speed: -1 }],
    ['a speed above 10000', { speed: 10_001 }],
    ['a speed that is not a number', { speed: 'fast' }],
    ['a tick interval below 10', { tickIntervalMs: 9 }],
    ['a tick interval above 60000', { tickIntervalMs: 60_001 }],
    ['a tick interval that is not whole', { tickIntervalMs: 100.5 }],
    ['a tick interval that is not a number', { tickIntervalMs: '1000' }],
    ['maxTicks of 0', { maxTicks: 0 }],
    ['negative maxTicks', { maxTicks: -3 }],
    ['maxTicks that is not whole', { maxTicks: 2.5 }],
    ['an unknown parameter', { interval: 1000 }],
  ])('answers 400 for %s and does not start', async (_name, payload) => {
    await setUp();

    const response = await start(payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect(response.json<ErrorBody>().error.details.length).toBeGreaterThan(0);
    expect((await getStatus()).json<Status>().running).toBe(false);
  });

  it('accepts the ends of the allowed ranges', async () => {
    for (const payload of [
      { speed: 0.001 },
      { speed: 10_000 },
      { tickIntervalMs: 10 },
      { tickIntervalMs: 60_000 },
      { maxTicks: 1 },
      { speed: 10_000, tickIntervalMs: 60_000 },
    ]) {
      await setUp();

      expect((await start(payload)).statusCode, JSON.stringify(payload)).toBe(200);

      await app.close();
    }
  });
});

describe('POST /simulator/stop', () => {
  it('stops a running simulator and returns its status', async () => {
    await setUp();
    await start();

    const response = await stop();

    expect(response.statusCode).toBe(200);
    expect(response.json<Status>().running).toBe(false);
    expect((await getStatus()).json<Status>().running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers 409 simulator_not_running when it is not running', async () => {
    await setUp();

    const response = await stop();

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('simulator_not_running');
  });

  it('answers 409 simulator_not_running when it is stopped twice', async () => {
    await setUp();
    await start();
    await stop();

    const response = await stop();

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('simulator_not_running');
  });

  it('accepts an empty object as the body', async () => {
    await setUp();
    await start();

    expect((await stop({})).statusCode).toBe(200);
  });

  it('answers 400 for a body that has fields', async () => {
    await setUp();
    await start();

    const response = await stop({ force: true });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect((await getStatus()).json<Status>().running).toBe(true);
  });
});

describe('the simulation', () => {
  /** An active account of a persona with the activity window of 09:00 to 21:00. */
  async function activeAccount(): Promise<Account> {
    const persona = await createPersona(app);
    const account = await createAccount(app, { personaId: persona.id });
    return moveAccount(app, account.id, ['onboarding', 'warming', 'active']);
  }

  it('advances the simulated time with every tick', async () => {
    await setUp();
    await start();

    await runTicks(3);

    const status = (await getStatus()).json<Status>();
    expect(status.tickCount).toBe(3);
    expect(status.simulatedTime).toBe(new Date(FIXED_NOW.getTime() + 3 * 60_000).toISOString());
  });

  it('stops by itself after maxTicks', async () => {
    await setUp();
    await start({ maxTicks: 2 });

    await runTicks(5);

    expect((await getStatus()).json<Status>()).toMatchObject({ running: false, tickCount: 2 });
    expect((await stop()).statusCode).toBe(409);
  });

  it('puts events of the simulator into GET /events', async () => {
    await setUp();
    const account = await activeAccount();
    const before = (await listEvents()).length;
    // One tick is an hour; the first twelve cover the rest of the day after 12:00.
    await start({ speed: 3600, maxTicks: 12 });

    await runTicks(12);

    const generated = (await listEvents()).filter(bySimulator);
    expect((await listEvents()).length).toBeGreaterThan(before);
    expect(generated.length).toBeGreaterThan(0);
    expect(new Set(generated.map((event) => event.type))).toContain('session_started');
    expect(
      generated.filter((event) => ['action_performed', 'action_failed'].includes(event.type))
        .length,
    ).toBeGreaterThan(0);
    for (const event of generated) {
      expect(event.accountId).toBe(account.id);
      expect(Date.parse(event.createdAt)).toBeGreaterThan(FIXED_NOW.getTime());
    }
    expect((await getStatus()).json<Status>().eventsGenerated).toBe(generated.length);
  });

  it('reports every session once, started and ended', async () => {
    await setUp();
    await activeAccount();
    await start({ speed: 3600, maxTicks: 14 });

    await runTicks(14);

    const generated = (await listEvents()).filter(bySimulator);
    const started = generated.filter((event) => event.type === 'session_started');
    const ended = generated.filter((event) => event.type === 'session_ended');
    expect(started.length).toBeGreaterThan(0);
    expect(ended).toHaveLength(started.length);
    expect(new Set(started.map((event) => event.payload.sessionId)).size).toBe(started.length);
  });

  it('can filter the events of the simulator by type', async () => {
    await setUp();
    await activeAccount();
    await start({ speed: 3600, maxTicks: 14 });
    await runTicks(14);

    const sessions = await listEvents('?type=session_started');

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((event) => event.type === 'session_started')).toBe(true);
  });

  it('shows up in the analytics snapshot', async () => {
    await setUp();
    await activeAccount();
    await start({ speed: 3600, maxTicks: 14 });
    await runTicks(14);

    const snapshot = (await app.inject({ method: 'GET', url: '/analytics/snapshot' })).json<{
      actionFailureMetrics: { date: string; performed: number; failed: number }[];
    }>();

    const total = snapshot.actionFailureMetrics.reduce(
      (sum, day) => sum + day.performed + day.failed,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it('changes the status of an account when the chance is certain', async () => {
    await setUp({ simulatorProbabilities: { warmingToActive: 1 } });
    const persona = await createPersona(app);
    const account = await createAccount(app, { personaId: persona.id });
    await moveAccount(app, account.id, ['onboarding', 'warming']);
    await start();

    await runTicks(1);

    const moved = (
      await app.inject({ method: 'GET', url: `/accounts/${account.id}` })
    ).json<Account>();
    expect(moved.status).toBe('active');
    const changes = (await listEvents(`?accountId=${account.id}&type=state_changed`)).filter(
      bySimulator,
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.payload).toEqual({ from: 'warming', to: 'active', source: 'simulator' });
  });

  it('does not create accounts or personas', async () => {
    await setUp({ simulatorProbabilities: { warmingToActive: 1, activeToLimited: 1 } });
    await activeAccount();
    await start({ speed: 3600, maxTicks: 6 });

    await runTicks(6);

    expect((await app.inject({ method: 'GET', url: '/accounts' })).json<Account[]>()).toHaveLength(
      1,
    );
    expect((await app.inject({ method: 'GET', url: '/personas' })).json<unknown[]>()).toHaveLength(
      1,
    );
  });

  it('does nothing without accounts', async () => {
    await setUp();
    await start({ speed: 3600, maxTicks: 3 });

    await runTicks(3);

    expect(await listEvents()).toEqual([]);
    expect((await getStatus()).json<Status>()).toMatchObject({ tickCount: 3, eventsGenerated: 0 });
  });

  it('gives the same events for the same seed', async () => {
    const run = async () => {
      await setUp();
      const account = await activeAccount();
      await start({ speed: 3600, maxTicks: 14 });
      await runTicks(14);
      const events = (await listEvents())
        .filter(bySimulator)
        .map(({ type, payload, createdAt }) => ({
          type,
          payload,
          createdAt,
        }));
      await app.close();
      // Ids are random in every run; what is compared is everything but them.
      return JSON.parse(JSON.stringify(events).replaceAll(account.id, 'ACCOUNT')) as unknown;
    };

    const first = await run();
    const second = await run();

    expect((first as unknown[]).length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});

describe('together with the rest of the service', () => {
  it('stops the timer when the app is closed', async () => {
    await setUp();
    await start();
    expect(vi.getTimerCount()).toBe(1);

    await app.close();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('lists the simulator routes at GET /api', async () => {
    await setUp();

    const { routes } = (await app.inject({ method: 'GET', url: '/api' })).json<{
      routes: { method: string; path: string }[];
    }>();

    expect(routes.filter((route) => route.path.startsWith('/simulator/'))).toEqual([
      expect.objectContaining({ method: 'GET', path: '/simulator/status' }),
      expect.objectContaining({ method: 'POST', path: '/simulator/start' }),
      expect.objectContaining({ method: 'POST', path: '/simulator/stop' }),
    ]);
  });

  it('does not clash with the dashboard files', async () => {
    await setUp();

    const page = await app.inject({ method: 'GET', url: '/dashboard/' });
    const wrongMethod = await app.inject({ method: 'GET', url: '/simulator/start' });

    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(wrongMethod.statusCode).toBe(404);
    expect(wrongMethod.json<ErrorBody>().error.code).toBe('not_found');
  });
});
