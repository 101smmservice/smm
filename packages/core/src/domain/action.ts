export const ACTION_TYPES = ['view', 'like', 'follow', 'post', 'comment'] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export function isActionType(value: unknown): value is ActionType {
  return typeof value === 'string' && (ACTION_TYPES as readonly string[]).includes(value);
}

export type ActionOutcomeStatus =
  'success' | 'failed' | 'rate_limited' | 'challenge' | 'restricted';

export interface ActionResult {
  status: ActionOutcomeStatus;
  error?: string;
  retryAfterMs?: number;
  challengeType?: string;
  data?: Record<string, unknown>;
}

export type PolicyDecisionReason =
  | 'allowed'
  | 'account_not_eligible'
  | 'no_policy'
  | 'skip_day'
  | 'budget_exhausted'
  | 'invalid_action'
  | 'plan_not_found';

export interface PolicyDecision {
  allowed: boolean;
  reason: PolicyDecisionReason;
  remainingBudget?: number;
}
