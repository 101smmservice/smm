import { isAccountStatus, ValidationError, type Account, type AccountStatus } from '@persona/core';

import type { StatusSummary } from './types.js';

/** Counts accounts per status and derives the share of the key statuses. Empty input yields zeros. */
export function summarizeAccounts(accounts: Account[]): StatusSummary {
  const byStatus: Record<AccountStatus, number> = {
    connected: 0,
    onboarding: 0,
    warming: 0,
    active: 0,
    limited: 0,
    review: 0,
    dead: 0,
  };

  for (const account of accounts) {
    if (!isAccountStatus(account.status)) {
      throw new ValidationError(
        `account ${account.id} has an unknown status: ${String(account.status)}`,
        'status',
      );
    }
    byStatus[account.status] += 1;
  }

  const total = accounts.length;
  const rateOf = (status: AccountStatus): number => (total === 0 ? 0 : byStatus[status] / total);

  return {
    total,
    byStatus,
    activeRate: rateOf('active'),
    limitedRate: rateOf('limited'),
    reviewRate: rateOf('review'),
    deadRate: rateOf('dead'),
  };
}
