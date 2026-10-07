import { ValidationError, type LifecycleEvent, type ScheduledAction } from '@persona/core';
import { BehaviorEngine } from '@persona/behavior';
import { createSeededRandom, PersonaEngine, StaticPolicyProvider } from '@persona/persona-engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PortfolioSimulator,
  SimulatorAlreadyRunningError,
  SimulatorError,
  SimulatorNotRunningError,
  type SimulatorDependencies,
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
/** With the default speed of 60, one tick of one second is one simulated minute. */
const MINUTE_MS = 60_000;

interface Rig {
  accounts: MemoryAccounts;
  personas: MemoryPersonas;
  events: MemoryEvents;
  personaEngine: FakePersonaEngine;
  behaviorEngine: FakeBehaviorEngine;
  simulator: PortfolioSimulator;
}

/**
 * One account with a persona and one planned session at 09:10, with the simulated time starting at
 * 09:00. Random events are off unless a test turns them on.
 */
function rig(
  options: {
    probabilities?: Partial<SimulatorProbabilities>;
    rng?: () => number;
    accountOverrides?: Parameters<typeof makeAccount>[0];
    withSession?: boolean;
  } = {},
): Rig {
  const accounts = new MemoryAccounts();
  const personas = new MemoryPersonas();
  const events = new MemoryEvents();
  const personaEngine = new FakePersonaEngine();
  const behaviorEngine = new FakeBehaviorEngine();

  void personas.save(makePersona());
  void accounts.save(makeAccount(options.accountOverrides));
  if (options.withSession !== false) {
    personaEngine.plan(makePlan('account-1', [SESSION]));
    behaviorEngine.sequence('account-1', SESSION.startAt, SESSION_ACTIONS);
  }

  const dependencies: SimulatorDependencies = {
    accounts,
    personas,
    events,
    personaEngine,
    behaviorEngine,
    clock: { now: () => START },
    rng: options.rng ?? (() => 0.5),
    probabilities: { ...NEVER, ...options.probabilities },
  };
  return {
    accounts,
    personas,
    events,
    personaEngine,
    behaviorEngine,
    simulator: new PortfolioSimulator(dependencies),
  };
}

/** Lets `count` ticks of `intervalMs` happen and waits for the last of them to finish. */
async function runTicks(simulator: PortfolioSimulator, count: number, intervalMs = TICK_MS) {
  for (let i = 0; i < count; i += 1) {
    await vi.advanceTimersByTimeAsync(intervalMs);
    await simulator.whenIdle();
  }
}

function shape(events: LifecycleEvent[]): unknown[] {
  return events.map(({ accountId, type, payload, createdAt }) => ({
    accountId,
    type,
    payload,
    createdAt,
  }));
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

function start(rigged: Rig, config?: Parameters<PortfolioSimulator['start']>[0]) {
  current = rigged.simulator;
  return rigged.simulator.start(config);
}

describe('lifecycle', () => {
  it('is not running at first', () => {
    const { simulator } = rig();

    expect(simulator.getStatus()).toEqual({
      running: false,
      simulatedTime: null,
      tickCount: 0,
      speed: 60,
      tickIntervalMs: 1000,
      eventsGenerated: 0,
      lastError: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is running after start, with the simulated time at the start of the clock', async () => {
    const rigged = rig();

    await start(rigged);

    expect(rigged.simulator.getStatus()).toMatchObject({
      running: true,
      simulatedTime: START.toISOString(),
      tickCount: 0,
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('refuses to start twice and keeps running', async () => {
    const rigged = rig();
    await start(rigged);

    await expect(rigged.simulator.start()).rejects.toBeInstanceOf(SimulatorAlreadyRunningError);

    expect(rigged.simulator.getStatus().running).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops, clears the timer and does not tick any more', async () => {
    const rigged = rig();
    await start(rigged);
    await runTicks(rigged.simulator, 2);

    await rigged.simulator.stop();
    await vi.advanceTimersByTimeAsync(10 * TICK_MS);

    const status = rigged.simulator.getStatus();
    expect(status.running).toBe(false);
    expect(status.tickCount).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses to stop when it is not running', async () => {
    const { simulator } = rig();

    await expect(simulator.stop()).rejects.toBeInstanceOf(SimulatorNotRunningError);

    await simulator.start();
    await simulator.stop();
    await expect(simulator.stop()).rejects.toBeInstanceOf(SimulatorNotRunningError);
  });

  it('uses errors that are domain errors', () => {
    expect(new SimulatorAlreadyRunningError()).toBeInstanceOf(SimulatorError);
    expect(new SimulatorNotRunningError()).toBeInstanceOf(SimulatorError);
    expect(new SimulatorAlreadyRunningError().code).toBe('SIMULATOR_ALREADY_RUNNING');
    expect(new SimulatorNotRunningError().code).toBe('SIMULATOR_NOT_RUNNING');
  });

  it('reports the configuration it runs with', async () => {
    const rigged = rig();

    await start(rigged, { speed: 120, tickIntervalMs: 500 });

    expect(rigged.simulator.getStatus()).toMatchObject({ speed: 120, tickIntervalMs: 500 });
  });

  it('can be started again after it was stopped, with counters reset', async () => {
    const rigged = rig();
    await start(rigged);
    await runTicks(rigged.simulator, 12);
    await rigged.simulator.stop();
    expect(rigged.simulator.getStatus().eventsGenerated).toBeGreaterThan(0);

    await start(rigged);

    expect(rigged.simulator.getStatus()).toMatchObject({
      running: true,
      simulatedTime: START.toISOString(),
      tickCount: 0,
      eventsGenerated: 0,
    });
  });

  it('stops by itself after maxTicks', async () => {
    const rigged = rig();
    await start(rigged, { maxTicks: 3 });

    await runTicks(rigged.simulator, 6);

    const status = rigged.simulator.getStatus();
    expect(status.running).toBe(false);
    expect(status.tickCount).toBe(3);
    expect(status.simulatedTime).toBe(new Date(START.getTime() + 3 * MINUTE_MS).toISOString());
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [{ speed: 0 }, 'speed'],
    [{ speed: -5 }, 'speed'],
    [{ speed: Number.NaN }, 'speed'],
    [{ speed: Number.POSITIVE_INFINITY }, 'speed'],
    [{ tickIntervalMs: 0 }, 'tickIntervalMs'],
    [{ tickIntervalMs: 1.5 }, 'tickIntervalMs'],
    [{ maxTicks: 0 }, 'maxTicks'],
    [{ maxTicks: 2.5 }, 'maxTicks'],
    [{ speed: 1_000_000, tickIntervalMs: 60_000 }, 'speed'],
  ])('rejects the configuration %j', async (config, field) => {
    const { simulator } = rig();

    const failure = await simulator.start(config).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ValidationError);
    expect((failure as ValidationError).field).toBe(field);
    expect(simulator.getStatus().running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects chances outside 0 to 1', () => {
    expect(() => rig({ probabilities: { actionFailure: 1.5 } })).toThrow(ValidationError);
    expect(() => rig({ probabilities: { restriction: -0.1 } })).toThrow(ValidationError);
  });
});

describe('ticks', () => {
  it('moves the simulated time by tickIntervalMs * speed', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 1);

    expect(rigged.simulator.getStatus()).toMatchObject({
      tickCount: 1,
      simulatedTime: new Date(START.getTime() + MINUTE_MS).toISOString(),
    });
  });

  it('uses the configured speed and interval', async () => {
    const rigged = rig();
    await start(rigged, { speed: 10, tickIntervalMs: 2000 });

    await runTicks(rigged.simulator, 3, 2000);

    expect(rigged.simulator.getStatus().simulatedTime).toBe(
      new Date(START.getTime() + 3 * 20_000).toISOString(),
    );
  });

  it('does not report a session before its time has come', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 9);

    expect(rigged.events.all).toHaveLength(0);
  });

  it('reports a session as the simulated time passes it', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 10);
    expect(rigged.events.all.map((event) => event.type)).toEqual([
      'session_started',
      'action_performed',
    ]);

    await runTicks(rigged.simulator, 1);
    expect(rigged.events.all.map((event) => event.type)).toEqual([
      'session_started',
      'action_performed',
      'action_performed',
      'action_performed',
      'session_ended',
    ]);
  });

  it('stamps events with the simulated time at which they happened', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    expect(rigged.events.all.map((event) => event.createdAt)).toEqual([
      at('09:10:00'),
      at('09:10:00'),
      at('09:10:30'),
      at('09:11:00'),
      at('09:11:00'),
    ]);
  });

  it('counts the events it has generated', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    expect(rigged.simulator.getStatus().eventsGenerated).toBe(5);
  });

  it('keeps events in the order of simulated time across accounts', async () => {
    const rigged = rig();
    await rigged.accounts.save(makeAccount({ id: 'account-2' }));
    rigged.personaEngine.plan(
      makePlan('account-2', [{ startAt: at('09:10:10'), maxDurationMinutes: 30 }]),
    );
    rigged.behaviorEngine.sequence('account-2', at('09:10:10'), [
      { type: 'view', delayAfterMs: 0, timestamp: at('09:10:10') },
    ]);
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    const times = rigged.events.all.map((event) => Date.parse(event.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(rigged.events.all.map((event) => event.accountId))).toEqual(
      new Set(['account-1', 'account-2']),
    );
  });

  it('plans through the persona engine and builds sequences through the behavior engine', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    expect(rigged.personaEngine.getActionPlan).toHaveBeenCalledWith('account-1', DATE);
    expect(rigged.behaviorEngine.generateSession).toHaveBeenCalledTimes(1);
    expect(rigged.behaviorEngine.generateSession).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-1', date: DATE }),
      SESSION,
    );
  });
});

describe('events of a session', () => {
  it('records action_performed for every action, with action, session and source', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    const performed = rigged.events.ofType('action_performed');
    expect(performed.map((event) => event.payload.action)).toEqual(['view', 'like', 'view']);
    for (const event of performed) {
      expect(event.accountId).toBe('account-1');
      expect(event.payload).toMatchObject({
        sessionId: `account-1:${SESSION.startAt}`,
        source: 'simulator',
      });
    }
    expect(rigged.events.ofType('action_failed')).toHaveLength(0);
  });

  it('records action_failed instead when the action fails', async () => {
    const rigged = rig({ probabilities: { actionFailure: 1 } });
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    expect(rigged.events.ofType('action_failed')).toHaveLength(3);
    expect(rigged.events.ofType('action_performed')).toHaveLength(0);
    expect(rigged.events.ofType('session_ended')[0]?.payload).toMatchObject({
      performed: 0,
      failed: 3,
    });
  });

  it('records restriction_detected with the chance it is given', async () => {
    const withRestrictions = rig({ probabilities: { restriction: 1 } });
    await start(withRestrictions);
    await runTicks(withRestrictions.simulator, 11);
    await withRestrictions.simulator.stop();

    const none = rig({ probabilities: { restriction: 0 } });
    await start(none);
    await runTicks(none.simulator, 11);

    const restrictions = withRestrictions.events.ofType('restriction_detected');
    expect(restrictions).toHaveLength(3);
    expect(restrictions[0]?.payload).toMatchObject({ source: 'simulator' });
    expect(typeof restrictions[0]?.payload.reason).toBe('string');
    expect(none.events.ofType('restriction_detected')).toHaveLength(0);
  });

  it('records session_started and session_ended once, with their figures', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    const sessionId = `account-1:${SESSION.startAt}`;
    expect(rigged.events.ofType('session_started')).toHaveLength(1);
    expect(rigged.events.ofType('session_started')[0]?.payload).toEqual({
      sessionId,
      plannedActions: 3,
      source: 'simulator',
    });
    expect(rigged.events.ofType('session_ended')[0]?.payload).toEqual({
      sessionId,
      performed: 3,
      failed: 0,
      source: 'simulator',
    });
  });

  it('does not repeat events of a session in later ticks', async () => {
    const rigged = rig();
    await start(rigged);

    await runTicks(rigged.simulator, 60);

    expect(rigged.events.all).toHaveLength(5);
    expect(new Set(rigged.events.all.map((event) => event.id)).size).toBe(5);
    expect(rigged.behaviorEngine.generateSession).toHaveBeenCalledTimes(1);
  });

  it('reports a session that is cut by a tick boundary in two steps, without repeating', async () => {
    const rigged = rig();
    await start(rigged, { speed: 30 });

    await runTicks(rigged.simulator, 40);

    expect(rigged.events.ofType('session_started')).toHaveLength(1);
    expect(rigged.events.ofType('action_performed')).toHaveLength(3);
    expect(rigged.events.ofType('session_ended')).toHaveLength(1);
  });

  it('reports a session without actions as started and ended', async () => {
    const rigged = rig();
    rigged.behaviorEngine.sequence('account-1', SESSION.startAt, []);
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    expect(rigged.events.all.map((event) => event.type)).toEqual([
      'session_started',
      'session_ended',
    ]);
  });
});

describe('what is skipped', () => {
  it('skips plans that are skip days', async () => {
    const rigged = rig({ withSession: false });
    rigged.personaEngine.plan(makePlan('account-1', [SESSION], { isSkipDay: true }));
    rigged.behaviorEngine.sequence('account-1', SESSION.startAt, SESSION_ACTIONS);
    await start(rigged);

    await runTicks(rigged.simulator, 30);

    expect(rigged.events.all).toHaveLength(0);
    expect(rigged.behaviorEngine.generateSession).not.toHaveBeenCalled();
  });

  it('does not report sessions that began before the simulation did', async () => {
    const rigged = rig({ withSession: false });
    const earlier = { startAt: at('08:00:00'), maxDurationMinutes: 30 };
    rigged.personaEngine.plan(makePlan('account-1', [earlier]));
    rigged.behaviorEngine.sequence('account-1', earlier.startAt, [
      { type: 'view', delayAfterMs: 0, timestamp: earlier.startAt },
    ]);
    await start(rigged);

    await runTicks(rigged.simulator, 30);

    expect(rigged.events.all).toHaveLength(0);
  });

  it('does not process dead accounts', async () => {
    const rigged = rig({ accountOverrides: { status: 'dead' } });
    await start(rigged);

    await runTicks(rigged.simulator, 30);

    expect(rigged.events.all).toHaveLength(0);
    expect(rigged.personaEngine.getActionPlan).not.toHaveBeenCalled();
  });

  it('does not plan for an account without a persona, and does not create one', async () => {
    const rigged = rig({ accountOverrides: { personaId: null } });
    await start(rigged);

    await runTicks(rigged.simulator, 30);

    expect(rigged.events.all).toHaveLength(0);
    expect(rigged.personaEngine.getActionPlan).not.toHaveBeenCalled();
    expect(rigged.personas.count()).toBe(1);
  });

  it('does not plan for an account whose persona is gone', async () => {
    const rigged = rig({ accountOverrides: { personaId: 'missing' } });
    await start(rigged);

    await runTicks(rigged.simulator, 30);

    expect(rigged.personaEngine.getActionPlan).not.toHaveBeenCalled();
  });

  it('creates neither accounts nor personas', async () => {
    const rigged = rig({
      probabilities: {
        actionFailure: 0.3,
        restriction: 0.3,
        warmingToActive: 0.5,
        activeToLimited: 0.5,
        limitedToReview: 0.5,
        reviewResolved: 0.5,
        reviewDeadShare: 0.5,
      },
    });
    await start(rigged, { speed: 3600 });

    await runTicks(rigged.simulator, 50);

    expect(await rigged.accounts.list()).toHaveLength(1);
    expect(rigged.personas.count()).toBe(1);
  });

  it('picks up accounts that are added while it runs', async () => {
    const rigged = rig({ withSession: false });
    await start(rigged);
    await runTicks(rigged.simulator, 2);

    await rigged.accounts.save(makeAccount({ id: 'account-2' }));
    rigged.personaEngine.plan(makePlan('account-2', [SESSION]));
    rigged.behaviorEngine.sequence('account-2', SESSION.startAt, SESSION_ACTIONS);
    await runTicks(rigged.simulator, 9);

    expect(new Set(rigged.events.all.map((event) => event.accountId))).toEqual(
      new Set(['account-2']),
    );
  });

  it('keeps going when one account cannot be processed', async () => {
    const rigged = rig();
    await rigged.accounts.save(makeAccount({ id: 'broken' }));
    rigged.personaEngine.getActionPlan.mockImplementation(async (accountId, date) => {
      if (accountId === 'broken') {
        throw new Error('plan unavailable');
      }
      return rigged.personaEngine.plans.get(`${accountId}:${date}`) ?? makePlan(accountId, []);
    });
    await start(rigged);

    await runTicks(rigged.simulator, 11);

    expect(rigged.events.ofType('session_ended')).toHaveLength(1);
    expect(rigged.simulator.getStatus().lastError).toBe('plan unavailable');
    expect(rigged.simulator.getStatus().running).toBe(true);
  });
});

describe('status changes', () => {
  async function runWithStatus(
    status: 'warming' | 'active' | 'limited' | 'review' | 'connected' | 'onboarding',
    probabilities: Partial<SimulatorProbabilities>,
  ) {
    const rigged = rig({ accountOverrides: { status }, withSession: false, probabilities });
    await start(rigged);
    await runTicks(rigged.simulator, 1);
    return rigged;
  }

  it.each([
    ['warming', { warmingToActive: 1 }, 'active'],
    ['active', { activeToLimited: 1 }, 'limited'],
    ['limited', { limitedToReview: 1 }, 'review'],
    ['review', { reviewResolved: 1, reviewDeadShare: 0 }, 'warming'],
    ['review', { reviewResolved: 1, reviewDeadShare: 1 }, 'dead'],
  ] as const)(
    'moves %s on to the next status when it is due (%j -> %s)',
    async (status, probabilities, expected) => {
      const rigged = await runWithStatus(status, probabilities);

      const [event] = rigged.events.ofType('state_changed');
      expect(event?.payload).toEqual({ from: status, to: expected, source: 'simulator' });
      expect(event?.createdAt).toBe(new Date(START.getTime() + MINUTE_MS).toISOString());
      const saved = await rigged.accounts.getById('account-1');
      expect(saved).toMatchObject({
        status: expected,
        statusChangedAt: new Date(START.getTime() + MINUTE_MS).toISOString(),
      });
    },
  );

  it('does not change a status that has no step to take', async () => {
    for (const status of ['connected', 'onboarding'] as const) {
      const rigged = await runWithStatus(status, {
        warmingToActive: 1,
        activeToLimited: 1,
        limitedToReview: 1,
        reviewResolved: 1,
      });

      expect(rigged.events.ofType('state_changed')).toHaveLength(0);
      expect((await rigged.accounts.getById('account-1'))?.status).toBe(status);
      await rigged.simulator.stop();
    }
  });

  it('does not change anything when the chances are 0', async () => {
    const rigged = await runWithStatus('warming', {});

    expect(rigged.events.ofType('state_changed')).toHaveLength(0);
    expect((await rigged.accounts.getById('account-1'))?.status).toBe('warming');
  });

  it('moves an account by one status per tick at most', async () => {
    const rigged = rig({
      accountOverrides: { status: 'warming' },
      withSession: false,
      probabilities: { warmingToActive: 1, activeToLimited: 1, limitedToReview: 1 },
    });
    await start(rigged);

    await runTicks(rigged.simulator, 1);
    expect((await rigged.accounts.getById('account-1'))?.status).toBe('active');

    await runTicks(rigged.simulator, 1);
    expect((await rigged.accounts.getById('account-1'))?.status).toBe('limited');
  });

  it('scales the daily chance to the time a tick covers', async () => {
    // A chance of 0.5 per day, drawn at 0.4: a tick of one minute is far too short for it, a tick
    // of a day is not.
    const short = rig({
      accountOverrides: { status: 'warming' },
      withSession: false,
      probabilities: { warmingToActive: 0.5 },
      rng: () => 0.4,
    });
    await start(short);
    await runTicks(short.simulator, 1);
    await short.simulator.stop();
    expect(short.events.ofType('state_changed')).toHaveLength(0);

    const long = rig({
      accountOverrides: { status: 'warming' },
      withSession: false,
      probabilities: { warmingToActive: 0.5 },
      rng: () => 0.4,
    });
    await start(long, { speed: 86.4, tickIntervalMs: 1_000_000 });
    await runTicks(long.simulator, 1, 1_000_000);
    expect(long.events.ofType('state_changed')).toHaveLength(1);
  });

  it('leaves an account alone that was changed by someone else during the tick', async () => {
    const rigged = rig({
      accountOverrides: { status: 'warming' },
      withSession: false,
      probabilities: { warmingToActive: 1 },
    });
    const getById = rigged.accounts.getById.bind(rigged.accounts);
    vi.spyOn(rigged.accounts, 'getById').mockImplementation(async (id) => {
      const account = await getById(id);
      return account === null ? null : { ...account, status: 'limited' };
    });
    await start(rigged);

    await runTicks(rigged.simulator, 1);

    expect(rigged.events.ofType('state_changed')).toHaveLength(0);
  });
});

describe('time that passes in large steps', () => {
  it('reports sessions of every day a tick covers', async () => {
    const rigged = rig({ withSession: false });
    const days = ['2026-07-01', '2026-07-02', '2026-07-03'];
    for (const [index, date] of days.entries()) {
      const slot = { startAt: at('12:00:00', date), maxDurationMinutes: 30 };
      rigged.personaEngine.plan(makePlan('account-1', [slot], { date }));
      rigged.behaviorEngine.sequence('account-1', slot.startAt, [
        { type: 'view', delayAfterMs: 0, timestamp: slot.startAt },
      ]);
      expect(index).toBeLessThan(3);
    }
    // 10000 x 60000 ms = about 6.9 simulated days in a single tick.
    await start(rigged, { speed: 10_000, tickIntervalMs: 60_000 });

    await runTicks(rigged.simulator, 1, 60_000);

    expect(rigged.events.ofType('session_started')).toHaveLength(3);
    expect(rigged.events.ofType('session_ended')).toHaveLength(3);
  });

  it('finds a session that was planned for the day before the one it begins on', async () => {
    const rigged = rig({ withSession: false });
    const lateStart = { startAt: '2026-07-02T00:30:00.000Z', maxDurationMinutes: 30 };
    const actions: ScheduledAction[] = [
      { type: 'view', delayAfterMs: 0, timestamp: lateStart.startAt },
    ];
    rigged.personaEngine.plan(makePlan('account-1', [lateStart]));
    rigged.behaviorEngine.sequence('account-1', lateStart.startAt, actions);
    // The simulated time starts at 23:00 and moves by an hour per tick.
    const clock = { now: () => new Date('2026-07-01T23:00:00.000Z') };
    const simulator = new PortfolioSimulator({
      accounts: rigged.accounts,
      personas: rigged.personas,
      events: rigged.events,
      personaEngine: rigged.personaEngine,
      behaviorEngine: rigged.behaviorEngine,
      clock,
      probabilities: NEVER,
    });
    current = simulator;
    await simulator.start({ speed: 3600 });

    await runTicks(simulator, 2);

    expect(rigged.events.ofType('session_started')).toHaveLength(1);
  });
});

describe('determinism', () => {
  const CHANCES: Partial<SimulatorProbabilities> = {
    actionFailure: 0.3,
    restriction: 0.2,
    warmingToActive: 0.7,
    activeToLimited: 0.7,
    limitedToReview: 0.7,
    reviewResolved: 0.7,
    reviewDeadShare: 0.3,
  };

  async function run(seed: number): Promise<unknown[]> {
    const rigged = rig({ probabilities: CHANCES, rng: createSeededRandom(seed) });
    await start(rigged, { speed: 600 });
    await runTicks(rigged.simulator, 30);
    await rigged.simulator.stop();
    return shape(rigged.events.all);
  }

  it('produces the same events for the same rng', async () => {
    const first = await run(11);
    const second = await run(11);

    expect(first.length).toBeGreaterThan(5);
    expect(second).toEqual(first);
  });

  it('produces other events for another rng', async () => {
    const first = await run(11);
    const other = await run(12);

    expect(other).not.toEqual(first);
  });
});

describe('with the real engines', () => {
  const policy = {
    stage: 'active' as const,
    maxSessionMinutes: 30,
    sessionsPerDay: [2, 3] as [number, number],
    actions: {
      view: { maxPerDay: 40, probabilityPerEncounter: 1 },
      like: { maxPerDay: 10, probabilityPerEncounter: 0.15 },
      follow: { maxPerDay: 3, probabilityPerEncounter: 0.06 },
      post: { maxPerDay: 1, probabilityPerEncounter: 0.5 },
      comment: { maxPerDay: 2, probabilityPerEncounter: 0.1 },
    },
    minIntervalMinutes: [2, 10] as [number, number],
    skipDayProbability: 0,
  };

  async function run(seed: number): Promise<MemoryEvents> {
    const accounts = new MemoryAccounts();
    const personas = new MemoryPersonas();
    const events = new MemoryEvents();
    await personas.save(makePersona());
    await accounts.save(makeAccount({ status: 'active' }));
    const clock = { now: () => START };
    const personaEngine = new PersonaEngine({
      accounts,
      personas,
      policyProvider: new StaticPolicyProvider({ active: policy }),
      rng: createSeededRandom(seed),
      clock,
    });
    const simulator = new PortfolioSimulator({
      accounts,
      personas,
      events,
      personaEngine,
      behaviorEngine: new BehaviorEngine({ rng: createSeededRandom(seed + 1) }),
      clock,
      rng: createSeededRandom(seed + 2),
      probabilities: NEVER,
    });
    current = simulator;
    // One tick is two simulated hours, so a day passes in twelve ticks.
    await simulator.start({ speed: 7200 });
    await runTicks(simulator, 24);
    await simulator.stop();
    return events;
  }

  it('generates the sessions and actions of a day plan', async () => {
    const events = await run(5);

    const started = events.ofType('session_started');
    const ended = events.ofType('session_ended');
    expect(started.length).toBeGreaterThan(0);
    expect(ended).toHaveLength(started.length);
    expect(events.ofType('action_performed').length).toBeGreaterThan(0);
    for (const event of events.all) {
      expect(event.payload.source).toBe('simulator');
    }
  });

  it('generates the same events for the same seeds', async () => {
    const first = await run(5);
    const second = await run(5);

    expect(shape(second.all)).toEqual(shape(first.all));
  });
});
