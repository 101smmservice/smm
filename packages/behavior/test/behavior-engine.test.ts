import {
  ACTION_TYPES,
  ValidationError,
  type ActionSequence,
  type ActionType,
  type DailyPlan,
  type SessionSlot,
} from '@persona/core';
import { describe, expect, it } from 'vitest';

import { allocateSessionBudgets, BehaviorEngine, createSeededRandom } from '../src/index.js';

const MORNING: SessionSlot = { startAt: '2026-07-01T09:00:00.000Z', maxDurationMinutes: 30 };
const AFTERNOON: SessionSlot = { startAt: '2026-07-01T14:00:00.000Z', maxDurationMinutes: 30 };

function makePlan(overrides: Partial<DailyPlan> = {}): DailyPlan {
  return {
    accountId: 'acc_1',
    date: '2026-07-01',
    sessions: [MORNING, AFTERNOON],
    actionBudgets: { view: 10, like: 3, follow: 1, post: 1, comment: 2 },
    isSkipDay: false,
    ...overrides,
  };
}

function countByType(sequence: ActionSequence): Record<ActionType, number> {
  const counts: Record<ActionType, number> = { view: 0, like: 0, follow: 0, post: 0, comment: 0 };
  for (const action of sequence.actions) {
    counts[action.type] += 1;
  }
  return counts;
}

function engine(seed = 1): BehaviorEngine {
  return new BehaviorEngine({ rng: createSeededRandom(seed) });
}

const SEEDS = Array.from({ length: 50 }, (_, index) => index + 1);

describe('BehaviorEngine.generateSession', () => {
  describe('empty sequences', () => {
    it('returns an empty sequence on a skip day', () => {
      const sequence = engine().generateSession(makePlan({ isSkipDay: true }), MORNING);

      expect(sequence).toEqual({
        accountId: 'acc_1',
        planDate: '2026-07-01',
        sessionStartAt: MORNING.startAt,
        actions: [],
        totalDurationMinutes: 0,
      });
    });

    it.each([0, -5])('returns an empty sequence for maxDurationMinutes %i', (minutes) => {
      const slot = { startAt: MORNING.startAt, maxDurationMinutes: minutes };

      const sequence = engine().generateSession(makePlan({ sessions: [slot] }), slot);

      expect(sequence.actions).toEqual([]);
      expect(sequence.totalDurationMinutes).toBe(0);
    });

    it('returns an empty sequence when every budget is zero', () => {
      const plan = makePlan({
        actionBudgets: { view: 0, like: 0, follow: 0, post: 0, comment: 0 },
      });

      const sequence = engine().generateSession(plan, MORNING);

      expect(sequence.actions).toEqual([]);
      expect(sequence.totalDurationMinutes).toBe(0);
      expect(sequence.sessionStartAt).toBe(MORNING.startAt);
    });

    it('returns an empty sequence when the session share of the budget is zero', () => {
      const plan = makePlan({
        actionBudgets: { view: 0, like: 1, follow: 0, post: 0, comment: 0 },
      });

      expect(engine().generateSession(plan, MORNING).actions).toHaveLength(1);
      expect(engine().generateSession(plan, AFTERNOON).actions).toEqual([]);
    });
  });

  describe('validation', () => {
    it('throws a ValidationError when the session is not part of the plan', () => {
      const unknown = { startAt: '2026-07-01T20:00:00.000Z', maxDurationMinutes: 30 };

      expect(() => engine().generateSession(makePlan(), unknown)).toThrow(ValidationError);
    });

    it('matches the session by both start and duration', () => {
      const differentDuration = { startAt: MORNING.startAt, maxDurationMinutes: 45 };

      expect(() => engine().generateSession(makePlan(), differentDuration)).toThrow(
        ValidationError,
      );
    });

    it('throws a ValidationError for a plan without sessions', () => {
      expect(() => engine().generateSession(makePlan({ sessions: [] }), MORNING)).toThrow(
        ValidationError,
      );
    });

    it('throws a ValidationError when the session start is not a timestamp', () => {
      const slot = { startAt: 'not a date', maxDurationMinutes: 30 };

      expect(() => engine().generateSession(makePlan({ sessions: [slot] }), slot)).toThrow(
        ValidationError,
      );
    });
  });

  describe('generated sequences', () => {
    it('identifies the account, the plan date and the session', () => {
      const sequence = engine().generateSession(makePlan(), AFTERNOON);

      expect(sequence.accountId).toBe('acc_1');
      expect(sequence.planDate).toBe('2026-07-01');
      expect(sequence.sessionStartAt).toBe(AFTERNOON.startAt);
    });

    it('stays within the session share of every budget and uses all of it when time allows', () => {
      for (const seed of SEEDS) {
        const plan = makePlan();
        for (const [index, slot] of plan.sessions.entries()) {
          const allocated = allocateSessionBudgets(plan.actionBudgets, index, plan.sessions.length);

          const counts = countByType(engine(seed).generateSession(plan, slot));

          for (const action of ACTION_TYPES) {
            expect(counts[action]).toBeLessThanOrEqual(allocated[action]);
          }
          expect(counts).toEqual(allocated);
        }
      }
    });

    it('never exceeds the daily budget across all sessions', () => {
      const plan = makePlan();
      const total: Record<ActionType, number> = {
        view: 0,
        like: 0,
        follow: 0,
        post: 0,
        comment: 0,
      };

      for (const slot of plan.sessions) {
        const counts = countByType(engine().generateSession(plan, slot));
        for (const action of ACTION_TYPES) {
          total[action] += counts[action];
        }
      }

      expect(total).toEqual(plan.actionBudgets);
    });

    it('starts at the session start and spaces actions by their delays', () => {
      for (const seed of SEEDS) {
        const { actions } = engine(seed).generateSession(makePlan(), MORNING);

        expect(actions[0]?.timestamp).toBe(MORNING.startAt);
        for (let index = 1; index < actions.length; index += 1) {
          const previous = actions[index - 1];
          const current = actions[index];
          const elapsed =
            Date.parse(current?.timestamp ?? '') - Date.parse(previous?.timestamp ?? '');

          expect(elapsed).toBe(previous?.delayAfterMs);
        }
      }
    });

    it('has strictly increasing ISO 8601 timestamps', () => {
      for (const seed of SEEDS) {
        const { actions } = engine(seed).generateSession(makePlan(), MORNING);

        for (const action of actions) {
          expect(new Date(action.timestamp).toISOString()).toBe(action.timestamp);
        }
        for (let index = 1; index < actions.length; index += 1) {
          expect(Date.parse(actions[index]?.timestamp ?? '')).toBeGreaterThan(
            Date.parse(actions[index - 1]?.timestamp ?? ''),
          );
        }
      }
    });

    it('leaves no pause after the final action and gives every other action a pause', () => {
      const { actions } = engine().generateSession(makePlan(), MORNING);

      expect(actions.at(-1)?.delayAfterMs).toBe(0);
      for (const action of actions.slice(0, -1)) {
        expect(action.delayAfterMs).toBeGreaterThan(0);
      }
    });

    it('reports the time from the session start to the last action in minutes', () => {
      const sequence = engine().generateSession(makePlan(), MORNING);

      const last = sequence.actions.at(-1);
      const elapsedMs = Date.parse(last?.timestamp ?? '') - Date.parse(MORNING.startAt);
      expect(sequence.totalDurationMinutes).toBeCloseTo(elapsedMs / 60_000, 10);
      expect(sequence.totalDurationMinutes).toBeGreaterThan(0);
    });

    it('never exceeds the maximum session duration', () => {
      const tightSlot = { startAt: MORNING.startAt, maxDurationMinutes: 1 };
      const plan = makePlan({
        sessions: [tightSlot],
        actionBudgets: { view: 100, like: 10, follow: 5, post: 2, comment: 5 },
      });

      for (const seed of SEEDS) {
        const sequence = engine(seed).generateSession(plan, tightSlot);

        expect(sequence.totalDurationMinutes).toBeLessThanOrEqual(1);
        expect(sequence.actions.length).toBeGreaterThan(0);
        expect(sequence.actions.length).toBeLessThan(121);
        for (const action of sequence.actions) {
          expect(Date.parse(action.timestamp) - Date.parse(tightSlot.startAt)).toBeLessThanOrEqual(
            60_000,
          );
        }
      }
    });

    it('keeps the default session within its limit as well', () => {
      for (const seed of SEEDS) {
        for (const slot of [MORNING, AFTERNOON]) {
          const sequence = engine(seed).generateSession(makePlan(), slot);

          expect(sequence.totalDurationMinutes).toBeLessThanOrEqual(slot.maxDurationMinutes);
        }
      }
    });

    it('opens with a view whenever the session has views', () => {
      for (const seed of SEEDS) {
        expect(engine(seed).generateSession(makePlan(), MORNING).actions[0]?.type).toBe('view');
      }
    });

    it('can run a session without views', () => {
      const plan = makePlan({
        actionBudgets: { view: 0, like: 2, follow: 0, post: 0, comment: 0 },
        sessions: [MORNING],
      });

      const sequence = engine().generateSession(plan, MORNING);

      expect(sequence.actions.map((action) => action.type)).toEqual(['like', 'like']);
    });

    it('interleaves the other actions among the views', () => {
      const positions = new Set<number>();
      for (const seed of SEEDS) {
        const { actions } = engine(seed).generateSession(makePlan(), MORNING);
        positions.add(actions.findIndex((action) => action.type === 'like'));
      }

      expect(positions.size).toBeGreaterThan(1);
    });

    it('does not set a target', () => {
      const { actions } = engine().generateSession(makePlan(), MORNING);

      for (const action of actions) {
        expect(action.targetId).toBeUndefined();
      }
    });

    it('is deterministic for the same rng sequence', () => {
      expect(engine(7).generateSession(makePlan(), MORNING)).toEqual(
        engine(7).generateSession(makePlan(), MORNING),
      );
    });

    it('differs for a different rng sequence', () => {
      expect(engine(7).generateSession(makePlan(), MORNING)).not.toEqual(
        engine(8).generateSession(makePlan(), MORNING),
      );
    });

    it('does not mutate the plan or the slot', () => {
      const plan = makePlan();
      const snapshot = structuredClone(plan);
      const slot = { ...MORNING };

      engine().generateSession(plan, slot);

      expect(plan).toEqual(snapshot);
      expect(slot).toEqual(MORNING);
    });

    it('works with the default rng', () => {
      const sequence = new BehaviorEngine().generateSession(makePlan(), MORNING);

      expect(sequence.actions.length).toBeGreaterThan(0);
      expect(sequence.totalDurationMinutes).toBeLessThanOrEqual(MORNING.maxDurationMinutes);
    });
  });
});
