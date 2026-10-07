import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_STATUSES,
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  InvalidStateTransitionError,
  requiresManualReview,
  transitionAccount,
  ValidationError,
  type Account,
  type AccountStatus,
} from '../src/index.js';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    platform: 'telegram',
    status: 'connected',
    personaId: null,
    deviceProfileId: null,
    proxyBindingId: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    connectedAt: '2025-01-01T00:00:00.000Z',
    statusChangedAt: '2025-01-01T00:00:00.000Z',
    metadata: { source: 'test' },
    ...overrides,
  };
}

describe('canTransition', () => {
  it.each<[AccountStatus, AccountStatus]>([
    ['connected', 'onboarding'],
    ['onboarding', 'warming'],
    ['onboarding', 'review'],
    ['warming', 'active'],
    ['warming', 'limited'],
    ['active', 'limited'],
    ['limited', 'review'],
    ['review', 'warming'],
    ['review', 'dead'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => {
      assertTransition(from, to);
    }).not.toThrow();
  });

  it.each<[AccountStatus, AccountStatus]>([
    ['connected', 'active'],
    ['limited', 'warming'],
    ['limited', 'active'],
    ['limited', 'onboarding'],
    ['limited', 'connected'],
    ['dead', 'connected'],
  ])('forbids %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => {
      assertTransition(from, to);
    }).toThrow(InvalidStateTransitionError);
  });

  it('forbids every transition that is not explicitly allowed', () => {
    for (const from of ACCOUNT_STATUSES) {
      for (const to of ACCOUNT_STATUSES) {
        const expected = ALLOWED_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('allows nothing out of dead', () => {
    for (const to of ACCOUNT_STATUSES) {
      expect(canTransition('dead', to)).toBe(false);
    }
  });

  it('allows only limited -> review out of limited', () => {
    const targets = ACCOUNT_STATUSES.filter((to) => canTransition('limited', to));
    expect(targets).toEqual(['review']);
  });

  it('forbids staying in the same status', () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('rejects unknown statuses at runtime', () => {
    const unknown = 'banned' as unknown as AccountStatus;
    expect(canTransition(unknown, 'active')).toBe(false);
    expect(canTransition('active', unknown)).toBe(false);
  });
});

describe('assertTransition', () => {
  it('throws InvalidStateTransitionError carrying from and to', () => {
    try {
      assertTransition('dead', 'connected');
      expect.unreachable('assertTransition should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateTransitionError);
      const typed = error as InvalidStateTransitionError;
      expect(typed.from).toBe('dead');
      expect(typed.to).toBe('connected');
      expect(typed.code).toBe('INVALID_STATE_TRANSITION');
      expect(typed.message).toContain('dead -> connected');
    }
  });
});

describe('requiresManualReview', () => {
  it('flags only review -> warming', () => {
    for (const from of ACCOUNT_STATUSES) {
      for (const to of ACCOUNT_STATUSES) {
        expect(requiresManualReview(from, to)).toBe(from === 'review' && to === 'warming');
      }
    }
  });
});

describe('transitionAccount', () => {
  it('returns a new object and does not mutate the original', () => {
    const account = makeAccount();
    const snapshot = structuredClone(account);

    const next = transitionAccount(account, 'onboarding', new Date('2025-02-01T10:00:00.000Z'));

    expect(next).not.toBe(account);
    expect(next.status).toBe('onboarding');
    expect(account).toEqual(snapshot);
    expect(account.status).toBe('connected');
  });

  it('updates statusChangedAt using the provided date', () => {
    const next = transitionAccount(
      makeAccount(),
      'onboarding',
      new Date('2025-02-01T10:00:00.000Z'),
    );

    expect(next.statusChangedAt).toBe('2025-02-01T10:00:00.000Z');
  });

  it('uses the current time when no date is provided', () => {
    const before = Date.now();
    const next = transitionAccount(makeAccount(), 'onboarding');
    const after = Date.now();

    const changedAt = new Date(next.statusChangedAt);
    expect(changedAt.toISOString()).toBe(next.statusChangedAt);
    expect(changedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(changedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('keeps all other fields unchanged', () => {
    const account = makeAccount({ personaId: 'persona-1', proxyBindingId: 'proxy-1' });
    const next = transitionAccount(account, 'onboarding', new Date('2025-02-01T10:00:00.000Z'));

    expect(next).toEqual({
      ...account,
      status: 'onboarding',
      statusChangedAt: '2025-02-01T10:00:00.000Z',
    });
  });

  it('walks the full happy path connected -> active', () => {
    let account = makeAccount();
    for (const status of ['onboarding', 'warming', 'active'] as const) {
      account = transitionAccount(account, status);
    }
    expect(account.status).toBe('active');
  });

  it('throws InvalidStateTransitionError on a forbidden transition and leaves the account intact', () => {
    const account = makeAccount({ status: 'limited' });

    expect(() => transitionAccount(account, 'warming')).toThrow(InvalidStateTransitionError);
    expect(account.status).toBe('limited');
  });

  it('throws ValidationError for an invalid date', () => {
    expect(() => transitionAccount(makeAccount(), 'onboarding', new Date('not a date'))).toThrow(
      ValidationError,
    );
  });
});
