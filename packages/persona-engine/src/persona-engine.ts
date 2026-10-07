import {
  isActionType,
  ValidationError,
  type Account,
  type AccountRepository,
  type ActionResult,
  type ActionType,
  type ActivityPolicy,
  type DailyPlan,
  type IPersonaEngine,
  type Persona,
  type PersonaRepository,
  type PolicyDecision,
} from '@persona/core';

import { assertDateString, createClock, getUtcDateString } from './clock.js';
import { createZeroBudgets, DailyPlanGenerator } from './daily-plan-generator.js';
import { resolvePolicy } from './policy-calculator.js';
import type { PolicyProvider } from './policy-provider.js';
import { defaultRandom } from './random.js';
import { InMemoryActionLedger, type ActionLedger, type Clock, type RandomFn } from './types.js';

export interface PersonaEngineOptions {
  accounts: AccountRepository;
  personas: PersonaRepository;
  policyProvider: PolicyProvider;
  rng?: RandomFn;
  clock?: Clock;
  ledger?: ActionLedger;
}

export class PersonaEngine implements IPersonaEngine {
  private readonly accounts: AccountRepository;
  private readonly personas: PersonaRepository;
  private readonly policyProvider: PolicyProvider;
  private readonly rng: RandomFn;
  private readonly clock: Clock;
  private readonly ledger: ActionLedger;
  private readonly planGenerator = new DailyPlanGenerator();
  /** Plans cached per `accountId:date` for the lifetime of the engine instance. */
  private readonly plans = new Map<string, DailyPlan>();

  constructor(options: PersonaEngineOptions) {
    this.accounts = options.accounts;
    this.personas = options.personas;
    this.policyProvider = options.policyProvider;
    this.rng = options.rng ?? defaultRandom();
    this.clock = options.clock ?? createClock();
    this.ledger = options.ledger ?? new InMemoryActionLedger();
  }

  async assignPersona(accountId: string, personaId: string): Promise<void> {
    const account = await this.requireAccount(accountId);
    const persona = await this.personas.getById(personaId);
    if (persona === null) {
      throw new ValidationError(`persona not found: ${personaId}`, 'personaId');
    }

    await this.accounts.save({ ...account, personaId });
  }

  async getPersona(accountId: string): Promise<Persona | null> {
    const account = await this.requireAccount(accountId);
    if (account.personaId === null) {
      return null;
    }
    return this.personas.getById(account.personaId);
  }

  async getPolicy(accountId: string): Promise<ActivityPolicy> {
    const account = await this.requireAccount(accountId);
    return resolvePolicy(account.status, this.policyProvider);
  }

  async getActionPlan(accountId: string, date: string): Promise<DailyPlan> {
    assertDateString(date);
    const account = await this.requireAccount(accountId);
    return this.planFor(account, date);
  }

  async canPerformAction(accountId: string, action: ActionType): Promise<PolicyDecision> {
    if (!isActionType(action)) {
      return { allowed: false, reason: 'invalid_action' };
    }

    const account = await this.accounts.getById(accountId);
    if (account === null) {
      return { allowed: false, reason: 'account_not_eligible' };
    }

    const date = getUtcDateString(this.clock.now());
    const plan = await this.planFor(account, date);
    if (plan.isSkipDay) {
      return { allowed: false, reason: 'skip_day' };
    }

    const budget = plan.actionBudgets[action] ?? 0;
    const remaining = budget - this.ledger.getUsed(accountId, date, action);
    if (remaining <= 0) {
      return { allowed: false, reason: 'budget_exhausted', remainingBudget: 0 };
    }
    return { allowed: true, reason: 'allowed', remainingBudget: remaining };
  }

  async recordAction(accountId: string, action: ActionType, result: ActionResult): Promise<void> {
    if (!isActionType(action)) {
      throw new ValidationError(`unknown action type: ${String(action)}`, 'action');
    }

    // Only completed actions spend budget; failures, limits and challenges do not.
    if (result.status === 'success') {
      this.ledger.increment(accountId, getUtcDateString(this.clock.now()), action);
    }
  }

  private async requireAccount(accountId: string): Promise<Account> {
    const account = await this.accounts.getById(accountId);
    if (account === null) {
      throw new ValidationError(`account not found: ${accountId}`, 'accountId');
    }
    return account;
  }

  private async planFor(account: Account, date: string): Promise<DailyPlan> {
    const key = `${account.id}:${date}`;
    const cached = this.plans.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const persona =
      account.personaId === null ? null : await this.personas.getById(account.personaId);
    if (persona === null) {
      // Without a persona there is no activity window to plan in. Not cached, so the plan can
      // be generated once a persona has been assigned.
      return {
        accountId: account.id,
        date,
        sessions: [],
        actionBudgets: createZeroBudgets(),
        isSkipDay: true,
      };
    }

    // A concurrent call may have produced the plan while the persona was being loaded.
    const raced = this.plans.get(key);
    if (raced !== undefined) {
      return raced;
    }

    const plan = this.planGenerator.generate({
      account,
      persona,
      policy: resolvePolicy(account.status, this.policyProvider),
      date,
      rng: this.rng,
    });
    this.plans.set(key, plan);
    return plan;
  }
}
