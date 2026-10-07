import type { AccountStatus } from '../domain/account.js';

/**
 * Allowed account lifecycle transitions. Every transition that is not listed here is forbidden.
 *
 * - `limited` can only move to `review`; `dead` is terminal.
 * - `review -> warming` is allowed only as the outcome of a manual review (see
 *   {@link requiresManualReview}).
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<AccountStatus, readonly AccountStatus[]>> =
  Object.freeze({
    connected: Object.freeze<AccountStatus[]>(['onboarding']),
    onboarding: Object.freeze<AccountStatus[]>(['warming', 'review']),
    warming: Object.freeze<AccountStatus[]>(['active', 'limited']),
    active: Object.freeze<AccountStatus[]>(['limited']),
    limited: Object.freeze<AccountStatus[]>(['review']),
    review: Object.freeze<AccountStatus[]>(['warming', 'dead']),
    dead: Object.freeze<AccountStatus[]>([]),
  });

/**
 * Whether an (otherwise allowed) transition may only happen as the result of a manual review.
 * The state machine cannot know who made the decision, so callers are responsible for checking
 * this before calling `transitionAccount`.
 */
export function requiresManualReview(from: AccountStatus, to: AccountStatus): boolean {
  return from === 'review' && to === 'warming';
}
