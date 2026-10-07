import type {
  Account,
  ActionSequence,
  ActivityPolicy,
  DailyPlan,
  IBehaviorEngine,
  IPersonaEngine,
  LifecycleEvent,
  LifecycleEventStore,
  Persona,
  PersonaRepository,
  PolicyDecision,
  ScheduledAction,
  SessionSlot,
} from '@persona/core';
import { vi } from 'vitest';

import type { SimulatorAccountRepository, SimulatorProbabilities } from '../src/index.js';

/** 2026-07-01 is a Wednesday. The simulated time of the tests starts here. */
export const START = new Date('2026-07-01T09:00:00.000Z');
export const DATE = '2026-07-01';

/** No random event ever happens. Individual tests switch on the ones they look at. */
export const NEVER: SimulatorProbabilities = {
  actionFailure: 0,
  restriction: 0,
  warmingToActive: 0,
  activeToLimited: 0,
  limitedToReview: 0,
  reviewResolved: 0,
  reviewDeadShare: 0,
};

export class MemoryAccounts implements SimulatorAccountRepository {
  private readonly items = new Map<string, Account>();

  async getById(id: string): Promise<Account | null> {
    const account = this.items.get(id);
    return account === undefined ? null : structuredClone(account);
  }

  async save(account: Account): Promise<Account> {
    this.items.set(account.id, structuredClone(account));
    return structuredClone(account);
  }

  async list(): Promise<Account[]> {
    return [...this.items.values()].map((account) => structuredClone(account));
  }
}

export class MemoryPersonas implements PersonaRepository {
  private readonly items = new Map<string, Persona>();

  async getById(id: string): Promise<Persona | null> {
    return this.items.get(id) ?? null;
  }

  async save(persona: Persona): Promise<Persona> {
    this.items.set(persona.id, persona);
    return persona;
  }

  count(): number {
    return this.items.size;
  }
}

export class MemoryEvents implements LifecycleEventStore {
  readonly all: LifecycleEvent[] = [];

  async append(event: LifecycleEvent): Promise<void> {
    this.all.push(event);
  }

  async findByAccountId(accountId: string): Promise<LifecycleEvent[]> {
    return this.all.filter((event) => event.accountId === accountId);
  }

  ofType(type: LifecycleEvent['type']): LifecycleEvent[] {
    return this.all.filter((event) => event.type === type);
  }
}

export function makePersona(id = 'persona-1'): Persona {
  return {
    id,
    timezone: 'UTC',
    locale: 'en-GB',
    niche: 'cooking',
    tone: 'friendly',
    topics: ['recipes'],
    audience: 'home cooks',
    activityWindow: { startHour: 0, endHour: 23, weekendActive: true },
  };
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    platform: 'telegram',
    status: 'warming',
    personaId: 'persona-1',
    deviceProfileId: null,
    proxyBindingId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    connectedAt: '2026-06-01T00:00:00.000Z',
    statusChangedAt: '2026-06-01T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

export function at(time: string, date = DATE): string {
  return `${date}T${time}.000Z`;
}

export function makePlan(
  accountId: string,
  sessions: SessionSlot[],
  overrides: Partial<DailyPlan> = {},
): DailyPlan {
  return {
    accountId,
    date: DATE,
    sessions,
    actionBudgets: {},
    isSkipDay: false,
    ...overrides,
  };
}

/** A persona engine whose plans are given by the test. Anything but planning is not supported. */
export class FakePersonaEngine implements IPersonaEngine {
  readonly plans = new Map<string, DailyPlan>();
  readonly getActionPlan = vi.fn(async (accountId: string, date: string): Promise<DailyPlan> => {
    return (
      this.plans.get(`${accountId}:${date}`) ?? {
        accountId,
        date,
        sessions: [],
        actionBudgets: {},
        isSkipDay: true,
      }
    );
  });

  plan(plan: DailyPlan): void {
    this.plans.set(`${plan.accountId}:${plan.date}`, plan);
  }

  async assignPersona(): Promise<void> {
    throw new Error('not supported by FakePersonaEngine');
  }

  async getPersona(): Promise<Persona | null> {
    throw new Error('not supported by FakePersonaEngine');
  }

  async getPolicy(): Promise<ActivityPolicy> {
    throw new Error('not supported by FakePersonaEngine');
  }

  async canPerformAction(): Promise<PolicyDecision> {
    throw new Error('not supported by FakePersonaEngine');
  }

  async recordAction(): Promise<void> {
    throw new Error('not supported by FakePersonaEngine');
  }
}

/** A behavior engine that hands out the sequence the test prepared for a session. */
export class FakeBehaviorEngine implements IBehaviorEngine {
  readonly sequences = new Map<string, ScheduledAction[]>();
  readonly generateSession = vi.fn((plan: DailyPlan, slot: SessionSlot): ActionSequence => {
    const actions = this.sequences.get(`${plan.accountId}:${slot.startAt}`) ?? [];
    return {
      accountId: plan.accountId,
      planDate: plan.date,
      sessionStartAt: slot.startAt,
      actions,
      totalDurationMinutes: 0,
    };
  });

  sequence(accountId: string, startAt: string, actions: ScheduledAction[]): void {
    this.sequences.set(`${accountId}:${startAt}`, actions);
  }
}

/** The session used by most tests: starts at 09:10, three actions, the last one at 09:11. */
export const SESSION: SessionSlot = { startAt: at('09:10:00'), maxDurationMinutes: 30 };

export const SESSION_ACTIONS: ScheduledAction[] = [
  { type: 'view', delayAfterMs: 30_000, timestamp: at('09:10:00') },
  { type: 'like', delayAfterMs: 30_000, timestamp: at('09:10:30') },
  { type: 'view', delayAfterMs: 0, timestamp: at('09:11:00') },
];
