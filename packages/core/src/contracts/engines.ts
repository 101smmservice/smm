import type { ActionResult, ActionType, PolicyDecision } from '../domain/action.js';
import type { ActionSequence } from '../domain/action-sequence.js';
import type { ActivityPolicy } from '../domain/activity-policy.js';
import type { DailyPlan, SessionSlot } from '../domain/daily-plan.js';
import type { Persona } from '../domain/persona.js';

export interface IPersonaEngine {
  assignPersona(accountId: string, personaId: string): Promise<void>;
  getPersona(accountId: string): Promise<Persona | null>;
  getPolicy(accountId: string): Promise<ActivityPolicy>;
  getActionPlan(accountId: string, date: string): Promise<DailyPlan>;
  canPerformAction(accountId: string, action: ActionType): Promise<PolicyDecision>;
  recordAction(accountId: string, action: ActionType, result: ActionResult): Promise<void>;
}

export interface IBehaviorEngine {
  generateSession(plan: DailyPlan, sessionSlot: SessionSlot): ActionSequence;
}
