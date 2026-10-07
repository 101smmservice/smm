import {
  ValidationError,
  type Account,
  type ActionType,
  type ActivityPolicy,
  type DailyPlan,
  type Persona,
  type SessionSlot,
} from '@persona/core';

import { parseDateString } from './clock.js';
import { isEmptyPolicy } from './policy-calculator.js';
import type { RandomFn } from './types.js';

const MS_PER_MINUTE = 60_000;

export interface GenerateDailyPlanInput {
  account: Account;
  persona: Persona;
  policy: ActivityPolicy;
  /** YYYY-MM-DD */
  date: string;
  rng: RandomFn;
}

export function createActionBudgets(policy: ActivityPolicy): Record<ActionType, number> {
  return {
    view: policy.actions.view.maxPerDay,
    like: policy.actions.like.maxPerDay,
    follow: policy.actions.follow.maxPerDay,
    post: policy.actions.post.maxPerDay,
    comment: policy.actions.comment.maxPerDay,
  };
}

export function createZeroBudgets(): Record<ActionType, number> {
  return { view: 0, like: 0, follow: 0, post: 0, comment: 0 };
}

/**
 * Builds the activity plan of one account for one UTC calendar date.
 *
 * The plan is a pure function of its input: with the same `rng` sequence it always produces
 * the same plan. Time zones are intentionally not converted; the activity window is read as
 * UTC hours of `date`.
 */
export class DailyPlanGenerator {
  generate(input: GenerateDailyPlanInput): DailyPlan {
    const { account, persona, policy, date, rng } = input;
    const { year, month, day } = parseDateString(date);

    const actionBudgets = createActionBudgets(policy);
    const skipDay = (): DailyPlan => ({
      accountId: account.id,
      date,
      sessions: [],
      actionBudgets,
      isSkipDay: true,
    });

    if (isEmptyPolicy(policy) || policy.sessionsPerDay[1] === 0) {
      return skipDay();
    }

    const dayStartMs = Date.UTC(year, month - 1, day);
    const weekday = new Date(dayStartMs).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    if (isWeekend && !persona.activityWindow.weekendActive) {
      return skipDay();
    }

    if (rng() < policy.skipDayProbability) {
      return skipDay();
    }

    return {
      accountId: account.id,
      date,
      sessions: planSessions(persona, policy, dayStartMs, rng),
      actionBudgets,
      isSkipDay: false,
    };
  }
}

/**
 * Places sessions inside the activity window without overlap, in chronological order.
 *
 * Every session is `maxSessionMinutes` long and consecutive sessions are at least
 * `minIntervalMinutes[0]` apart. If the window cannot hold the drawn number of sessions, fewer
 * are planned; if it cannot hold even one, a single session starts at the window start.
 */
function planSessions(
  persona: Persona,
  policy: ActivityPolicy,
  dayStartMs: number,
  rng: RandomFn,
): SessionSlot[] {
  const { startHour, endHour } = persona.activityWindow;
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    endHour > 24 ||
    startHour >= endHour
  ) {
    throw new ValidationError(
      'activityWindow must satisfy 0 <= startHour < endHour <= 24 (UTC hours)',
      'activityWindow',
    );
  }

  const [minSessions, maxSessions] = policy.sessionsPerDay;
  if (
    !Number.isInteger(minSessions) ||
    !Number.isInteger(maxSessions) ||
    minSessions < 0 ||
    minSessions > maxSessions
  ) {
    throw new ValidationError('sessionsPerDay must be [min, max] with 0 <= min <= max', 'policy');
  }

  const windowStart = startHour * 60;
  const windowLength = (endHour - startHour) * 60;
  const sessionLength = Math.ceil(policy.maxSessionMinutes);
  const gap = Math.ceil(policy.minIntervalMinutes[0]);
  const stride = sessionLength + gap;

  const drawn = Math.min(
    maxSessions,
    minSessions + Math.floor(rng() * (maxSessions - minSessions + 1)),
  );
  const capacity = stride > 0 ? Math.max(1, Math.floor((windowLength + gap) / stride)) : drawn;
  const count = Math.min(drawn, capacity);

  // Distribute the free minutes of the window randomly in front of the sessions.
  const free = Math.max(0, windowLength - (count * sessionLength + (count - 1) * gap));
  const offsets = Array.from({ length: count }, () => Math.floor(rng() * (free + 1))).sort(
    (a, b) => a - b,
  );

  return offsets.map((offset, index) => {
    const startMinute = windowStart + offset + index * stride;
    return {
      startAt: new Date(dayStartMs + startMinute * MS_PER_MINUTE).toISOString(),
      maxDurationMinutes: policy.maxSessionMinutes,
    };
  });
}
