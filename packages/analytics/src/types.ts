import type { AccountStatus } from '@persona/core';

export interface DateRange {
  /** YYYY-MM-DD, inclusive */
  startDate: string;
  /** YYYY-MM-DD, inclusive */
  endDate: string;
}

export interface StatusSummary {
  total: number;
  byStatus: Record<AccountStatus, number>;
  activeRate: number;
  limitedRate: number;
  reviewRate: number;
  deadRate: number;
}

export interface TransitionMatrixCell {
  from: AccountStatus;
  to: AccountStatus;
  count: number;
}

export interface DailyRestrictionMetric {
  /** YYYY-MM-DD */
  date: string;
  restrictionEvents: number;
  accountsAffected: number;
}

export interface DailyActionFailureMetric {
  /** YYYY-MM-DD */
  date: string;
  performed: number;
  failed: number;
  failureRate: number;
}

/**
 * Publications of content: attempts that were recorded as `action_performed` (`published`) or
 * `action_failed` (`failed`) events with `action: 'post'` and the `contentId` of the item.
 */
export interface PublicationMetrics {
  total: number;
  published: number;
  failed: number;
}

export interface CohortSurvivalPoint {
  /** YYYY-MM-DD */
  cohortDate: string;
  day: number;
  total: number;
  alive: number;
  survivalRate: number;
}

export interface AnalyticsSnapshot {
  /** ISO 8601 */
  generatedAt: string;
  statusSummary: StatusSummary;
  transitionMatrix: TransitionMatrixCell[];
  restrictionFrequency: DailyRestrictionMetric[];
  actionFailureMetrics: DailyActionFailureMetric[];
  publicationMetrics: PublicationMetrics;
  cohortSurvival: CohortSurvivalPoint[];
}
