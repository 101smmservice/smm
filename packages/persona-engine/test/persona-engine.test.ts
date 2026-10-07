import {
  ACTION_TYPES,
  ValidationError,
  type Account,
  type AccountRepository,
  type ActionOutcomeStatus,
  type ActionType,
  type ActivityPolicy,
  type Persona,
  type PersonaRepository,
} from '@persona/core';
import { describe, expect, it } from 'vitest';

import {
  createFixedClock,
  getUtcDateString,
  InMemoryActionLedger,
  isEmptyPolicy,
  PersonaEngine,
  StaticPolicyProvider,
  type RandomFn,
} from '../src/index.js';

// 2026-07-01 is a Wednesday.
const NOW = new Date('2026-07-01T12:00:00.000Z');
const TODAY = '2026-07-01';

class FakeAccountRepository implements AccountRepository {
  readonly items = new Map<string, Account>();

  getById(id: string): Promise<Account | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  save(account: Account): Promise<Account> {
    this.items.set(account.id, account);
    return Promise.resolve(account);
  }
}

class FakePersonaRepository implements PersonaRepository {
  readonly items = new Map<string, Persona>();

  getById(id: string): Promise<Persona | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  save(persona: Persona): Promise<Persona> {
    this.items.set(persona.id, persona);
    return Promise.resolve(persona);
  }
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc_1',
    platform: 'telegram',
    status: 'active',
    personaId: 'persona_1',
    deviceProfileId: null,
    proxyBindingId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    connectedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function makePersona(): Persona {
  return {
    id: 'persona_1',
    timezone: 'UTC',
    locale: 'en',
    niche: 'cooking',
    tone: 'friendly',
    topics: ['recipes'],
    audience: 'home cooks',
    activityWindow: { startHour: 9, endHour: 21, weekendActive: true },
  };
}

function makeActivePolicy(overrides: Partial<ActivityPolicy> = {}): ActivityPolicy {
  return {
    stage: 'active',
    maxSessionMinutes: 30,
    sessionsPerDay: [2, 4],
    actions: {
      view: { maxPerDay: 100, probabilityPerEncounter: 1 },
      like: { maxPerDay: 3, probabilityPerEncounter: 0.15 },
      follow: { maxPerDay: 8, probabilityPerEncounter: 0.06 },
      post: { maxPerDay: 2, probabilityPerEncounter: 0.5 },
      comment: { maxPerDay: 5, probabilityPerEncounter: 0.1 },
    },
    minIntervalMinutes: [2, 10],
    skipDayProbability: 0.05,
    ...overrides,
  };
}

interface Setup {
  accounts: FakeAccountRepository;
  personas: FakePersonaRepository;
  engine: PersonaEngine;
  rngCalls: () => number;
}

function setup(
  options: { rng?: RandomFn; policy?: ActivityPolicy; account?: Account | null } = {},
): Setup {
  const accounts = new FakeAccountRepository();
  const personas = new FakePersonaRepository();
  const account = options.account === undefined ? makeAccount() : options.account;
  if (account !== null) {
    accounts.items.set(account.id, account);
  }
  personas.items.set('persona_1', makePersona());

  let calls = 0;
  const baseRng = options.rng ?? (() => 0.99);
  const engine = new PersonaEngine({
    accounts,
    personas,
    policyProvider: new StaticPolicyProvider({ active: options.policy ?? makeActivePolicy() }),
    rng: () => {
      calls += 1;
      return baseRng();
    },
    clock: createFixedClock(NOW),
  });

  return { accounts, personas, engine, rngCalls: () => calls };
}

describe('PersonaEngine', () => {
  describe('assignPersona', () => {
    it('stores the personaId on the account', async () => {
      const { accounts, engine } = setup({ account: makeAccount({ personaId: null }) });

      await engine.assignPersona('acc_1', 'persona_1');

      expect(accounts.items.get('acc_1')?.personaId).toBe('persona_1');
    });

    it('does not mutate the account it loaded', async () => {
      const original = makeAccount({ personaId: null });
      const { engine } = setup({ account: original });

      await engine.assignPersona('acc_1', 'persona_1');

      expect(original.personaId).toBeNull();
    });

    it('throws a ValidationError when the account does not exist', async () => {
      const { engine } = setup({ account: null });

      await expect(engine.assignPersona('missing', 'persona_1')).rejects.toThrow(ValidationError);
    });

    it('throws a ValidationError when the persona does not exist', async () => {
      const { accounts, engine } = setup({ account: makeAccount({ personaId: null }) });

      await expect(engine.assignPersona('acc_1', 'missing')).rejects.toThrow(ValidationError);
      expect(accounts.items.get('acc_1')?.personaId).toBeNull();
    });
  });

  describe('getPersona', () => {
    it('returns null when the account has no persona', async () => {
      const { engine } = setup({ account: makeAccount({ personaId: null }) });

      expect(await engine.getPersona('acc_1')).toBeNull();
    });

    it('returns the assigned persona', async () => {
      const { engine } = setup();

      expect(await engine.getPersona('acc_1')).toEqual(makePersona());
    });

    it('throws a ValidationError when the account does not exist', async () => {
      const { engine } = setup({ account: null });

      await expect(engine.getPersona('missing')).rejects.toThrow(ValidationError);
    });
  });

  describe('getPolicy', () => {
    it('returns the active policy for an active account', async () => {
      const { engine } = setup();

      expect((await engine.getPolicy('acc_1')).stage).toBe('active');
    });

    it('returns the empty policy for an account in review', async () => {
      const { engine } = setup({ account: makeAccount({ status: 'review' }) });

      expect(isEmptyPolicy(await engine.getPolicy('acc_1'))).toBe(true);
    });

    it('returns the empty policy when the provider has no policy for the status', async () => {
      const { engine } = setup({ account: makeAccount({ status: 'warming' }) });

      expect(isEmptyPolicy(await engine.getPolicy('acc_1'))).toBe(true);
    });

    it('throws a ValidationError when the account does not exist', async () => {
      const { engine } = setup({ account: null });

      await expect(engine.getPolicy('missing')).rejects.toThrow(ValidationError);
    });
  });

  describe('getActionPlan', () => {
    it('builds a plan from the persona and the policy of the account', async () => {
      const { engine } = setup();

      const plan = await engine.getActionPlan('acc_1', TODAY);

      expect(plan.accountId).toBe('acc_1');
      expect(plan.date).toBe(TODAY);
      expect(plan.isSkipDay).toBe(false);
      expect(plan.sessions.length).toBeGreaterThan(0);
      expect(plan.actionBudgets.like).toBe(3);
    });

    it('caches the plan per account and date', async () => {
      const { engine, rngCalls } = setup();

      const first = await engine.getActionPlan('acc_1', TODAY);
      const callsAfterFirst = rngCalls();
      const second = await engine.getActionPlan('acc_1', TODAY);

      expect(second).toBe(first);
      expect(rngCalls()).toBe(callsAfterFirst);
      expect(callsAfterFirst).toBeGreaterThan(0);
    });

    it('plans each date separately', async () => {
      const { engine } = setup();

      const today = await engine.getActionPlan('acc_1', TODAY);
      const tomorrow = await engine.getActionPlan('acc_1', '2026-07-02');

      expect(tomorrow).not.toBe(today);
      expect(tomorrow.date).toBe('2026-07-02');
    });

    it('returns an empty skip day with zero budgets when the account has no persona', async () => {
      const { engine } = setup({ account: makeAccount({ personaId: null }) });

      expect(await engine.getActionPlan('acc_1', TODAY)).toEqual({
        accountId: 'acc_1',
        date: TODAY,
        sessions: [],
        actionBudgets: { view: 0, like: 0, follow: 0, post: 0, comment: 0 },
        isSkipDay: true,
      });
    });

    it('plans normally once a persona has been assigned after a persona-less request', async () => {
      const { engine } = setup({ account: makeAccount({ personaId: null }) });

      expect((await engine.getActionPlan('acc_1', TODAY)).isSkipDay).toBe(true);
      await engine.assignPersona('acc_1', 'persona_1');

      expect((await engine.getActionPlan('acc_1', TODAY)).isSkipDay).toBe(false);
    });

    it('returns a skip day for an account whose status has no policy', async () => {
      const { engine } = setup({ account: makeAccount({ status: 'review' }) });

      const plan = await engine.getActionPlan('acc_1', TODAY);

      expect(plan.isSkipDay).toBe(true);
      expect(plan.sessions).toEqual([]);
    });

    it('throws a ValidationError for a malformed date', async () => {
      const { engine } = setup();

      await expect(engine.getActionPlan('acc_1', '01.07.2026')).rejects.toThrow(ValidationError);
    });

    it('throws a ValidationError when the account does not exist', async () => {
      const { engine } = setup({ account: null });

      await expect(engine.getActionPlan('missing', TODAY)).rejects.toThrow(ValidationError);
    });

    it('returns the same plan to concurrent callers', async () => {
      const { engine } = setup();

      const [first, second] = await Promise.all([
        engine.getActionPlan('acc_1', TODAY),
        engine.getActionPlan('acc_1', TODAY),
      ]);

      expect(second).toBe(first);
    });
  });

  describe('canPerformAction', () => {
    it('rejects an unknown action type', async () => {
      const { engine } = setup();

      const decision = await engine.canPerformAction('acc_1', 'share' as unknown as ActionType);

      expect(decision).toEqual({ allowed: false, reason: 'invalid_action' });
    });

    it('reports an unknown account as not eligible', async () => {
      const { engine } = setup({ account: null });

      expect(await engine.canPerformAction('missing', 'view')).toEqual({
        allowed: false,
        reason: 'account_not_eligible',
      });
    });

    it('reports skip_day when the plan is a skip day', async () => {
      const { engine } = setup({ rng: () => 0 });

      expect(await engine.canPerformAction('acc_1', 'view')).toEqual({
        allowed: false,
        reason: 'skip_day',
      });
    });

    it('reports skip_day for an account whose status has no policy', async () => {
      const { engine } = setup({ account: makeAccount({ status: 'dead' }) });

      expect((await engine.canPerformAction('acc_1', 'view')).reason).toBe('skip_day');
    });

    it('allows an action and reports the remaining budget', async () => {
      const { engine } = setup();

      expect(await engine.canPerformAction('acc_1', 'like')).toEqual({
        allowed: true,
        reason: 'allowed',
        remainingBudget: 3,
      });
    });

    it('reports budget_exhausted once the budget is spent', async () => {
      const { engine } = setup();
      for (let count = 0; count < 3; count += 1) {
        await engine.recordAction('acc_1', 'like', { status: 'success' });
      }

      expect(await engine.canPerformAction('acc_1', 'like')).toEqual({
        allowed: false,
        reason: 'budget_exhausted',
        remainingBudget: 0,
      });
    });

    it('reports budget_exhausted for an action with a zero budget', async () => {
      const policy = makeActivePolicy();
      policy.actions.post = { maxPerDay: 0, probabilityPerEncounter: 0 };
      const { engine } = setup({ policy });

      expect((await engine.canPerformAction('acc_1', 'post')).reason).toBe('budget_exhausted');
    });

    it('tracks the budget of every action independently', async () => {
      const { engine } = setup();
      await engine.recordAction('acc_1', 'like', { status: 'success' });

      expect((await engine.canPerformAction('acc_1', 'like')).remainingBudget).toBe(2);
      expect((await engine.canPerformAction('acc_1', 'view')).remainingBudget).toBe(100);
    });
  });

  describe('recordAction', () => {
    it('spends one unit of budget per successful action', async () => {
      const { engine } = setup();

      await engine.recordAction('acc_1', 'like', { status: 'success' });
      await engine.recordAction('acc_1', 'like', { status: 'success' });

      expect((await engine.canPerformAction('acc_1', 'like')).remainingBudget).toBe(1);
    });

    it.each<ActionOutcomeStatus>(['failed', 'rate_limited', 'challenge', 'restricted'])(
      'does not spend budget on a %s result',
      async (status) => {
        const { engine } = setup();

        await engine.recordAction('acc_1', 'like', { status, error: 'details' });

        expect((await engine.canPerformAction('acc_1', 'like')).remainingBudget).toBe(3);
      },
    );

    it('does not throw when the budget is already exhausted', async () => {
      const { engine } = setup();
      for (let count = 0; count < 5; count += 1) {
        await expect(
          engine.recordAction('acc_1', 'like', { status: 'success' }),
        ).resolves.toBeUndefined();
      }

      expect((await engine.canPerformAction('acc_1', 'like')).reason).toBe('budget_exhausted');
    });

    it('rejects an unknown action type', async () => {
      const { engine } = setup();

      await expect(
        engine.recordAction('acc_1', 'share' as unknown as ActionType, { status: 'success' }),
      ).rejects.toThrow(ValidationError);
    });

    it('records against the current date of the clock', async () => {
      const ledger = new InMemoryActionLedger();
      const engine = new PersonaEngine({
        accounts: new FakeAccountRepository(),
        personas: new FakePersonaRepository(),
        policyProvider: new StaticPolicyProvider({}),
        clock: createFixedClock(NOW),
        ledger,
      });

      await engine.recordAction('acc_1', 'view', { status: 'success' });

      expect(ledger.getUsed('acc_1', TODAY, 'view')).toBe(1);
      expect(ledger.getUsed('acc_1', '2026-07-02', 'view')).toBe(0);
    });
  });
});

describe('InMemoryActionLedger', () => {
  it('counts per account, date and action', () => {
    const ledger = new InMemoryActionLedger();
    ledger.increment('a', TODAY, 'like');
    ledger.increment('a', TODAY, 'like');
    ledger.increment('a', TODAY, 'view');
    ledger.increment('b', TODAY, 'like');

    expect(ledger.getUsed('a', TODAY, 'like')).toBe(2);
    expect(ledger.getUsed('a', TODAY, 'view')).toBe(1);
    expect(ledger.getUsed('b', TODAY, 'like')).toBe(1);
    expect(ledger.getUsed('a', '2026-07-02', 'like')).toBe(0);
    for (const action of ACTION_TYPES) {
      expect(ledger.getUsed('unknown', TODAY, action)).toBe(0);
    }
  });
});

describe('clock helpers', () => {
  it('formats the UTC date of a moment', () => {
    expect(getUtcDateString(new Date('2026-07-01T23:59:59.999Z'))).toBe('2026-07-01');
    expect(getUtcDateString(new Date('2026-07-02T00:00:00.000Z'))).toBe('2026-07-02');
  });

  it('rejects an invalid Date', () => {
    expect(() => getUtcDateString(new Date('nope'))).toThrow(ValidationError);
  });

  it('keeps a fixed clock fixed and isolated from mutation', () => {
    const clock = createFixedClock(NOW);

    clock.now().setUTCFullYear(1999);

    expect(clock.now().toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });
});
