import type { ActionType } from './action.js';

export interface ScheduledAction {
  type: ActionType;
  targetId?: string;
  delayAfterMs: number;
  /** ISO 8601 */
  timestamp: string;
}

export interface ActionSequence {
  accountId: string;
  /** YYYY-MM-DD */
  planDate: string;
  /** ISO 8601 */
  sessionStartAt: string;
  actions: ScheduledAction[];
  totalDurationMinutes: number;
}
