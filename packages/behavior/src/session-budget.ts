import { ValidationError, type ActionType } from '@persona/core';

/**
 * Splits daily action budgets evenly across `sessionCount` sessions and returns the share of the
 * session at `sessionIndex`. Remainders go to the first sessions, so the shares of all sessions
 * add up to exactly the daily budget.
 */
export function allocateSessionBudgets(
  dailyBudgets: Record<string, number>,
  sessionIndex: number,
  sessionCount: number,
): Record<ActionType, number> {
  if (!Number.isInteger(sessionCount)) {
    throw new ValidationError('sessionCount must be an integer', 'sessionCount');
  }
  if (sessionCount <= 0) {
    return { view: 0, like: 0, follow: 0, post: 0, comment: 0 };
  }
  if (!Number.isInteger(sessionIndex) || sessionIndex < 0 || sessionIndex >= sessionCount) {
    throw new ValidationError(
      `sessionIndex must be an integer in [0, ${String(sessionCount - 1)}]`,
      'sessionIndex',
    );
  }

  const shareOf = (action: ActionType): number => {
    const daily = dailyBudgets[action] ?? 0;
    if (!Number.isInteger(daily) || daily < 0) {
      throw new ValidationError(`dailyBudgets.${action} must be an integer >= 0`, action);
    }
    const base = Math.floor(daily / sessionCount);
    const remainder = daily % sessionCount;
    return base + (sessionIndex < remainder ? 1 : 0);
  };

  return {
    view: shareOf('view'),
    like: shareOf('like'),
    follow: shareOf('follow'),
    post: shareOf('post'),
    comment: shareOf('comment'),
  };
}
