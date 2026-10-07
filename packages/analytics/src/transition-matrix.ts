import { isAccountStatus, type LifecycleEvent } from '@persona/core';

import type { TransitionMatrixCell } from './types.js';

/**
 * Counts `from -> to` pairs over the `state_changed` events. Events whose payload does not carry a
 * valid `from` and `to` status are skipped. Cells are ordered by `from`, then by `to`
 * (plain string order).
 */
export function buildTransitionMatrix(events: LifecycleEvent[]): TransitionMatrixCell[] {
  const cells = new Map<string, TransitionMatrixCell>();

  for (const event of events) {
    if (event.type !== 'state_changed') {
      continue;
    }
    const { from, to } = event.payload;
    if (!isAccountStatus(from) || !isAccountStatus(to)) {
      continue;
    }

    const key = `${from}>${to}`;
    const cell = cells.get(key);
    if (cell === undefined) {
      cells.set(key, { from, to, count: 1 });
    } else {
      cell.count += 1;
    }
  }

  return [...cells.values()].sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}
