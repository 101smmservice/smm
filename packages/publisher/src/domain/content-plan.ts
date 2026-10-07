import type { ContentStatus } from './content-status.js';

export interface ContentPlan {
  accountId: string;
  /** YYYY-MM-DD */
  date: string;
  itemIds: string[];
  counts: Record<ContentStatus, number>;
  isReady: boolean;
}

export function createEmptyStatusCounts(): Record<ContentStatus, number> {
  return {
    draft: 0,
    brief_ready: 0,
    planned: 0,
    ready: 0,
    scheduled: 0,
    published: 0,
    failed: 0,
    rejected: 0,
    archived: 0,
  };
}
