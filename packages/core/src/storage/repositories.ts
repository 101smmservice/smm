import type { Account } from '../domain/account.js';
import type { LifecycleEvent } from '../domain/lifecycle-event.js';
import type { Persona } from '../domain/persona.js';

export interface AccountRepository {
  getById(id: string): Promise<Account | null>;
  save(account: Account): Promise<Account>;
}

export interface PersonaRepository {
  getById(id: string): Promise<Persona | null>;
  save(persona: Persona): Promise<Persona>;
}

export interface LifecycleEventStore {
  append(event: LifecycleEvent): Promise<void>;
  findByAccountId(accountId: string): Promise<LifecycleEvent[]>;
}
