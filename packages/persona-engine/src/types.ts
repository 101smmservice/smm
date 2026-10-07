import type { ActionType } from '@persona/core';

/** Returns a number in the range [0, 1), like `Math.random`. */
export type RandomFn = () => number;

export interface Clock {
  now(): Date;
}

/** Tracks how much of each daily action budget has been spent. */
export interface ActionLedger {
  getUsed(accountId: string, date: string, action: ActionType): number;
  increment(accountId: string, date: string, action: ActionType): void;
}

export class InMemoryActionLedger implements ActionLedger {
  private readonly used = new Map<string, number>();

  getUsed(accountId: string, date: string, action: ActionType): number {
    return this.used.get(keyOf(accountId, date, action)) ?? 0;
  }

  increment(accountId: string, date: string, action: ActionType): void {
    const key = keyOf(accountId, date, action);
    this.used.set(key, (this.used.get(key) ?? 0) + 1);
  }
}

// `date` and `action` never contain "|", so the key is unambiguous for any accountId.
function keyOf(accountId: string, date: string, action: ActionType): string {
  return `${accountId}|${date}|${action}`;
}
