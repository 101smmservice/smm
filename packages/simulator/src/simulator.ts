import {
  createLifecycleEvent,
  transitionAccount,
  ValidationError,
  type Account,
  type AccountStatus,
  type ActionSequence,
  type DailyPlan,
  type LifecycleEvent,
  type LifecycleEventType,
  type SessionSlot,
} from '@persona/core';
import { defaultRandom } from '@persona/persona-engine';

import { SimulatorAlreadyRunningError, SimulatorNotRunningError } from './errors.js';
import { pickRandom, shouldOccur } from './random-events.js';
import type {
  SimulatorConfig,
  SimulatorDependencies,
  SimulatorProbabilities,
  SimulatorStatus,
} from './types.js';

const MS_PER_DAY = 86_400_000;

/** Ended sessions are forgotten once they are this far behind the simulated time. */
const SESSION_RETENTION_MS = 3 * MS_PER_DAY;

/** One tick never covers more than this, so a tick never plans an unbounded number of days. */
const MAX_TICK_SPAN_MS = 31 * MS_PER_DAY;

const SOURCE = 'simulator';

/** Prefix of the made-up identifier a simulated publication gets as `externalId`. */
export const SIMULATED_EXTERNAL_ID_PREFIX = 'sim-post-';

/** The `failureReason` of content whose simulated publication failed. */
export const SIMULATED_PUBLICATION_FAILURE_REASON = 'simulated_publication_error';

export const DEFAULT_SPEED = 60;
export const DEFAULT_TICK_INTERVAL_MS = 1000;

export const DEFAULT_PROBABILITIES: Readonly<Required<SimulatorProbabilities>> = Object.freeze({
  actionFailure: 0.05,
  restriction: 0.005,
  warmingToActive: 0.2,
  activeToLimited: 0.05,
  limitedToReview: 0.3,
  reviewResolved: 0.2,
  reviewDeadShare: 0.25,
  publicationSuccess: 0.9,
});

/** Labels of simulated restrictions. They only describe the generated event. */
const RESTRICTION_REASONS = ['temporary_limit', 'daily_limit_reached', 'review_required'] as const;

interface PublicationRecord {
  attempts: number;
  outcome: 'published' | 'failed' | 'error';
  /** The `updatedAt` of the item when it was tried; tells whether it was changed since. */
  updatedAt: string;
}

interface SessionState {
  readonly sessionId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly actions: ActionSequence['actions'];
  started: boolean;
  ended: boolean;
  nextAction: number;
  performed: number;
  failed: number;
}

/**
 * Generates lifecycle events for the accounts of the portfolio, in memory.
 *
 * Time is simulated: every tick moves it forward by `tickIntervalMs * speed`. For the accounts
 * that exist, the simulator follows the daily plan of the persona engine and the action sequences of
 * the behavior engine, and records what would have happened as events. It performs no actions on
 * any platform, makes no network calls, and never creates accounts or personas.
 */
export class PortfolioSimulator {
  private readonly deps: SimulatorDependencies;
  private readonly clock: { now(): Date };
  private readonly rng: () => number;
  private readonly probabilities: Required<SimulatorProbabilities>;
  /** Sessions that were started, by `accountId|date|startAt`, so none is reported twice. */
  private readonly sessions = new Map<string, SessionState>();
  /**
   * What became of the publication of a content item, by content id. An item that was published is
   * never tried again, and neither is one that could not be moved until it has been changed. One
   * that failed is tried again only if someone schedules it anew.
   */
  private readonly publications = new Map<string, PublicationRecord>();

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private speed = DEFAULT_SPEED;
  private tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
  private maxTicks: number | null = null;
  private simulatedMs: number | null = null;
  private startedMs = 0;
  private tickCount = 0;
  private eventsGenerated = 0;
  private lastError: string | null = null;
  private publicationsAttempted = 0;
  private publicationsSucceeded = 0;
  private publicationsFailed = 0;
  private inFlight: Promise<void> | null = null;

  constructor(deps: SimulatorDependencies) {
    this.deps = deps;
    this.clock = deps.clock ?? { now: () => new Date() };
    this.rng = deps.rng ?? defaultRandom();
    this.probabilities = resolveProbabilities(deps.probabilities);
  }

  /**
   * Starts the simulated time at the current moment of the clock and ticks every `tickIntervalMs`.
   * Only sessions that begin after the start are simulated. Throws `SimulatorAlreadyRunningError`
   * while the simulator is running.
   */
  async start(config: SimulatorConfig = {}): Promise<void> {
    if (this.running) {
      throw new SimulatorAlreadyRunningError();
    }
    const { speed, tickIntervalMs, maxTicks } = resolveConfig(config);
    const startedMs = this.clock.now().getTime();
    if (Number.isNaN(startedMs)) {
      throw new ValidationError('the clock must return a valid date', 'clock');
    }

    // A tick of an earlier run is allowed to finish first; it must not touch this run's state.
    await this.inFlight;

    this.sessions.clear();
    this.publications.clear();
    this.publicationsAttempted = 0;
    this.publicationsSucceeded = 0;
    this.publicationsFailed = 0;
    this.speed = speed;
    this.tickIntervalMs = tickIntervalMs;
    this.maxTicks = maxTicks;
    this.startedMs = startedMs;
    this.simulatedMs = startedMs;
    this.tickCount = 0;
    this.eventsGenerated = 0;
    this.lastError = null;
    this.running = true;

    this.timer = setInterval(() => {
      this.onTimer();
    }, tickIntervalMs);
    // A forgotten simulator must not keep the process alive.
    this.timer.unref();
  }

  /**
   * Stops the timer and waits for the tick in progress, if any. Throws `SimulatorNotRunningError`
   * when the simulator is not running, which includes a run that ended by reaching `maxTicks`.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      throw new SimulatorNotRunningError();
    }
    this.halt();
    await this.inFlight;
  }

  getStatus(): SimulatorStatus {
    return {
      running: this.running,
      simulatedTime: this.simulatedMs === null ? null : new Date(this.simulatedMs).toISOString(),
      tickCount: this.tickCount,
      speed: this.speed,
      tickIntervalMs: this.tickIntervalMs,
      eventsGenerated: this.eventsGenerated,
      lastError: this.lastError,
      publicationsAttempted: this.publicationsAttempted,
      publicationsSucceeded: this.publicationsSucceeded,
      publicationsFailed: this.publicationsFailed,
    };
  }

  /** Resolves when the tick in progress, if there is one, has finished. */
  async whenIdle(): Promise<void> {
    await this.inFlight;
  }

  private halt(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  private onTimer(): void {
    if (this.inFlight !== null) {
      // The previous tick is still working; this one is skipped instead of overlapping it.
      return;
    }
    this.inFlight = this.tick()
      .catch((error: unknown) => {
        this.lastError = describeError(error);
      })
      .finally(() => {
        this.inFlight = null;
      });
  }

  private async tick(): Promise<void> {
    if (!this.running || this.simulatedMs === null) {
      return;
    }
    const from = this.simulatedMs;
    const to = from + this.tickIntervalMs * this.speed;
    this.simulatedMs = to;
    this.tickCount += 1;

    const events: LifecycleEvent[] = [];
    for (const account of await this.deps.accounts.list()) {
      try {
        await this.processAccount(account, from, to, events);
      } catch (error) {
        // One account that cannot be processed must not hold up the others.
        this.lastError = describeError(error);
      }
    }

    // Events are stored in the order in which they happened in simulated time.
    events.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const event of events) {
      await this.deps.events.append(event);
      this.eventsGenerated += 1;
    }

    this.forgetOldSessions(from);
    if (this.maxTicks !== null && this.tickCount >= this.maxTicks) {
      this.halt();
    }
  }

  private async processAccount(
    account: Account,
    from: number,
    to: number,
    events: LifecycleEvent[],
  ): Promise<void> {
    if (account.status === 'dead') {
      return;
    }

    if (await this.hasPersona(account)) {
      for (const date of utcDatesCovering(from, to)) {
        const plan = await this.deps.personaEngine.getActionPlan(account.id, date);
        if (plan.isSkipDay) {
          continue;
        }
        for (const slot of plan.sessions) {
          await this.advanceSession(plan, slot, to, events);
        }
      }
    }

    await this.maybeChangeStatus(account, from, to, events);
  }

  /** Without a persona there is no plan to follow; the simulator does not create one. */
  private async hasPersona(account: Account): Promise<boolean> {
    if (account.personaId === null) {
      return false;
    }
    return (await this.deps.personas.getById(account.personaId)) !== null;
  }

  /** Reports what happened in the session up to `to`: its start, its actions, and its end. */
  private async advanceSession(
    plan: DailyPlan,
    slot: SessionSlot,
    to: number,
    events: LifecycleEvent[],
  ): Promise<void> {
    const startMs = Date.parse(slot.startAt);
    // Sessions that began before the simulation did, or that have not begun yet, are not reported.
    if (Number.isNaN(startMs) || startMs <= this.startedMs || startMs > to) {
      return;
    }

    const key = `${plan.accountId}|${plan.date}|${slot.startAt}`;
    let state = this.sessions.get(key);
    if (state === undefined) {
      const sequence = this.deps.behaviorEngine.generateSession(plan, slot);
      const lastAction = sequence.actions.at(-1);
      const lastMs = lastAction === undefined ? startMs : Date.parse(lastAction.timestamp);
      state = {
        sessionId: `${plan.accountId}:${slot.startAt}`,
        startMs,
        endMs: Math.max(startMs, Number.isNaN(lastMs) ? startMs : lastMs),
        actions: sequence.actions,
        started: false,
        ended: false,
        nextAction: 0,
        performed: 0,
        failed: 0,
      };
      this.sessions.set(key, state);
    }

    if (!state.started) {
      state.started = true;
      this.record(events, plan.accountId, 'session_started', startMs, {
        sessionId: state.sessionId,
        plannedActions: state.actions.length,
      });
    }

    while (state.nextAction < state.actions.length) {
      const action = state.actions[state.nextAction];
      const at = action === undefined ? Number.NaN : Date.parse(action.timestamp);
      if (action === undefined || Number.isNaN(at) || at > to) {
        break;
      }
      state.nextAction += 1;

      const failed = shouldOccur(this.probabilities.actionFailure, this.rng);
      if (failed) {
        state.failed += 1;
      } else {
        state.performed += 1;
      }
      this.record(events, plan.accountId, failed ? 'action_failed' : 'action_performed', at, {
        action: action.type,
        sessionId: state.sessionId,
      });

      if (shouldOccur(this.probabilities.restriction, this.rng)) {
        this.record(events, plan.accountId, 'restriction_detected', at, {
          reason: pickRandom(RESTRICTION_REASONS, this.rng) ?? 'unspecified',
        });
      }

      // The content planned for the day goes out right after the first action of a session.
      if (state.nextAction === 1) {
        await this.publishScheduledContent(plan.accountId, state.sessionId, at, events);
      }
    }

    if (!state.ended && state.nextAction >= state.actions.length && state.endMs <= to) {
      state.ended = true;
      this.record(events, plan.accountId, 'session_ended', state.endMs, {
        sessionId: state.sessionId,
        performed: state.performed,
        failed: state.failed,
      });
    }
  }

  /**
   * Tries to publish the content the account has scheduled for the simulated day of `atMs`. A
   * publication is only a domain event and a change of the status of the content item: nothing is
   * sent anywhere.
   */
  private async publishScheduledContent(
    accountId: string,
    sessionId: string,
    atMs: number,
    events: LifecycleEvent[],
  ): Promise<void> {
    const pipeline = this.deps.contentPipeline;
    if (pipeline === undefined) {
      return;
    }

    const at = new Date(atMs);
    const date = at.toISOString().slice(0, 10);
    for (const contentId of (await pipeline.planForDate(accountId, date)).itemIds) {
      const item = await pipeline.getItem(contentId);
      if (
        item?.status !== 'scheduled' ||
        item.accountId !== accountId ||
        item.plannedDate !== date
      ) {
        continue;
      }
      const previous = this.publications.get(contentId);
      if (
        previous?.outcome === 'published' ||
        (previous?.outcome === 'error' && previous.updatedAt === item.updatedAt)
      ) {
        continue;
      }

      this.publicationsAttempted += 1;
      const succeeded = shouldOccur(this.probabilities.publicationSuccess, this.rng);
      const externalId = `${SIMULATED_EXTERNAL_ID_PREFIX}${contentId}`;
      const remember = (outcome: PublicationRecord['outcome']): void => {
        this.publications.set(contentId, {
          attempts: (previous?.attempts ?? 0) + 1,
          outcome,
          updatedAt: item.updatedAt,
        });
      };
      try {
        if (succeeded) {
          await pipeline.markPublished(contentId, { at, externalId });
          this.publicationsSucceeded += 1;
          remember('published');
        } else {
          await pipeline.markFailed(contentId, SIMULATED_PUBLICATION_FAILURE_REASON, { at });
          this.publicationsFailed += 1;
          remember('failed');
        }
      } catch (error) {
        // The item stays as it is, and is not tried again until it changes.
        this.lastError = describeError(error);
        remember('error');
        continue;
      }

      this.record(events, accountId, succeeded ? 'action_performed' : 'action_failed', atMs, {
        action: 'post',
        contentId,
        sessionId,
        ...(succeeded ? { externalId } : { reason: SIMULATED_PUBLICATION_FAILURE_REASON }),
      });
    }
  }

  /** At most one status change per account and tick. */
  private async maybeChangeStatus(
    account: Account,
    from: number,
    to: number,
    events: LifecycleEvent[],
  ): Promise<void> {
    const target = this.drawNextStatus(account.status, (to - from) / MS_PER_DAY);
    if (target === null) {
      return;
    }

    // The account may have been changed by someone else since the tick began.
    const current = await this.deps.accounts.getById(account.id);
    if (current?.status !== account.status) {
      return;
    }

    await this.deps.accounts.save(transitionAccount(current, target, new Date(to)));
    this.record(events, account.id, 'state_changed', to, { from: current.status, to: target });
  }

  /** Draws the status the account moves to during `elapsedDays`, or `null` if it stays. */
  private drawNextStatus(status: AccountStatus, elapsedDays: number): AccountStatus | null {
    const chance = (perDay: number): number => 1 - (1 - perDay) ** elapsedDays;
    const p = this.probabilities;
    switch (status) {
      case 'warming':
        return shouldOccur(chance(p.warmingToActive), this.rng) ? 'active' : null;
      case 'active':
        return shouldOccur(chance(p.activeToLimited), this.rng) ? 'limited' : null;
      case 'limited':
        return shouldOccur(chance(p.limitedToReview), this.rng) ? 'review' : null;
      case 'review':
        if (!shouldOccur(chance(p.reviewResolved), this.rng)) {
          return null;
        }
        // The outcome of a manual review, which the simulator decides at random.
        return shouldOccur(p.reviewDeadShare, this.rng) ? 'dead' : 'warming';
      default:
        return null;
    }
  }

  private record(
    events: LifecycleEvent[],
    accountId: string,
    type: LifecycleEventType,
    atMs: number,
    payload: Record<string, unknown>,
  ): void {
    events.push(
      createLifecycleEvent({
        accountId,
        type,
        payload: { ...payload, source: SOURCE },
        createdAt: new Date(atMs),
      }),
    );
  }

  private forgetOldSessions(from: number): void {
    const horizon = from - SESSION_RETENTION_MS;
    for (const [key, state] of this.sessions) {
      if (state.ended && state.startMs < horizon) {
        this.sessions.delete(key);
      }
    }
  }
}

function resolveConfig(config: SimulatorConfig): {
  speed: number;
  tickIntervalMs: number;
  maxTicks: number | null;
} {
  const speed = config.speed ?? DEFAULT_SPEED;
  const tickIntervalMs = config.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const maxTicks = config.maxTicks ?? null;

  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
    throw new ValidationError('speed must be a positive number', 'speed');
  }
  if (!Number.isInteger(tickIntervalMs) || tickIntervalMs < 1) {
    throw new ValidationError('tickIntervalMs must be a positive integer', 'tickIntervalMs');
  }
  if (maxTicks !== null && (!Number.isInteger(maxTicks) || maxTicks < 1)) {
    throw new ValidationError('maxTicks must be a positive integer', 'maxTicks');
  }
  if (speed * tickIntervalMs > MAX_TICK_SPAN_MS) {
    throw new ValidationError('speed × tickIntervalMs must not exceed 31 days', 'speed');
  }
  return { speed, tickIntervalMs, maxTicks };
}

function resolveProbabilities(
  overrides: Partial<SimulatorProbabilities> | undefined,
): Required<SimulatorProbabilities> {
  const probabilities = { ...DEFAULT_PROBABILITIES, ...overrides };
  for (const [name, value] of Object.entries(probabilities)) {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
      throw new ValidationError(`probability ${name} must be a number from 0 to 1`, name);
    }
  }
  return probabilities;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * The UTC dates of the plans to look at for the time from `fromMs` to `toMs`: every date in the
 * span, and the day before it, because a session planned for one date can begin on the next.
 */
function utcDatesCovering(fromMs: number, toMs: number): string[] {
  const dates: string[] = [];
  for (let day = startOfUtcDay(fromMs) - MS_PER_DAY; day <= toMs; day += MS_PER_DAY) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
