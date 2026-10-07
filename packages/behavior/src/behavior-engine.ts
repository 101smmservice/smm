import {
  ValidationError,
  type ActionSequence,
  type ActionType,
  type DailyPlan,
  type IBehaviorEngine,
  type ScheduledAction,
  type SessionSlot,
} from '@persona/core';

import {
  DEFAULT_ACTION_DELAY,
  DEFAULT_VIEW_DELAY,
  sampleLognormalDelayMs,
} from './distributions.js';
import { defaultRandom, type RandomFn } from './random.js';
import { allocateSessionBudgets } from './session-budget.js';

const MS_PER_MINUTE = 60_000;

/** Non-view actions in the order they are interleaved into the session. */
const INTERLEAVED_ACTIONS = ['like', 'follow', 'comment', 'post'] as const;

export interface BehaviorEngineOptions {
  rng?: RandomFn;
}

export class BehaviorEngine implements IBehaviorEngine {
  private readonly rng: RandomFn;

  constructor(options: BehaviorEngineOptions = {}) {
    this.rng = options.rng ?? defaultRandom();
  }

  /**
   * Generates the ordered actions of one session of `plan`: which actions to take, the pause after
   * each of them, and nothing beyond the session's share of the daily budgets or its duration.
   */
  generateSession(plan: DailyPlan, sessionSlot: SessionSlot): ActionSequence {
    const emptySequence: ActionSequence = {
      accountId: plan.accountId,
      planDate: plan.date,
      sessionStartAt: sessionSlot.startAt,
      actions: [],
      totalDurationMinutes: 0,
    };

    if (plan.isSkipDay || sessionSlot.maxDurationMinutes <= 0) {
      return emptySequence;
    }

    const sessionIndex = plan.sessions.findIndex(
      (session) =>
        session.startAt === sessionSlot.startAt &&
        session.maxDurationMinutes === sessionSlot.maxDurationMinutes,
    );
    if (sessionIndex < 0) {
      throw new ValidationError('sessionSlot is not part of the plan', 'sessionSlot');
    }

    const startMs = Date.parse(sessionSlot.startAt);
    if (Number.isNaN(startMs)) {
      throw new ValidationError('sessionSlot.startAt must be an ISO 8601 timestamp', 'startAt');
    }

    const budgets = allocateSessionBudgets(plan.actionBudgets, sessionIndex, plan.sessions.length);
    const types = this.arrangeActions(budgets);

    const limitMs = Math.floor(sessionSlot.maxDurationMinutes * MS_PER_MINUTE);
    const actions: ScheduledAction[] = [];
    let offsetMs = 0;
    let lastOffsetMs = 0;
    for (const type of types) {
      if (offsetMs > limitMs) {
        break;
      }
      const delayAfterMs = this.sampleDelayAfter(type);
      const timestamp =
        offsetMs === 0 ? sessionSlot.startAt : new Date(startMs + offsetMs).toISOString();
      actions.push({ type, delayAfterMs, timestamp });
      lastOffsetMs = offsetMs;
      offsetMs += delayAfterMs;
    }

    const last = actions.pop();
    if (last === undefined) {
      return emptySequence;
    }
    // No pause follows the final action, so it also ends the session.
    actions.push({ ...last, delayAfterMs: 0 });

    return { ...emptySequence, actions, totalDurationMinutes: lastOffsetMs / MS_PER_MINUTE };
  }

  /**
   * Plans the order of actions: all views first, then every other budgeted action is inserted at
   * a random position among them. When there are views, the session always opens with one.
   */
  private arrangeActions(budgets: Record<ActionType, number>): ActionType[] {
    const types: ActionType[] = Array.from({ length: budgets.view }, () => 'view');
    const firstFreePosition = budgets.view > 0 ? 1 : 0;

    for (const type of INTERLEAVED_ACTIONS) {
      for (let count = 0; count < budgets[type]; count += 1) {
        const slots = types.length - firstFreePosition + 1;
        const position = firstFreePosition + Math.min(slots - 1, Math.floor(this.rng() * slots));
        types.splice(position, 0, type);
      }
    }
    return types;
  }

  private sampleDelayAfter(type: ActionType): number {
    const bounds = type === 'view' ? DEFAULT_VIEW_DELAY : DEFAULT_ACTION_DELAY;
    return sampleLognormalDelayMs({ rng: this.rng, ...bounds });
  }
}
