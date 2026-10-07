export interface SessionSlot {
  /** ISO 8601 */
  startAt: string;
  maxDurationMinutes: number;
}

export interface DailyPlan {
  accountId: string;
  /** YYYY-MM-DD */
  date: string;
  sessions: SessionSlot[];
  actionBudgets: Record<string, number>;
  isSkipDay: boolean;
}
