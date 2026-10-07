import { isValidDateString, toUtcDateString } from '@persona/analytics';
import {
  ValidationError,
  type Account,
  type AccountRepository,
  type AccountStatus,
  type LifecycleEvent,
  type LifecycleEventStore,
  type LifecycleEventType,
  type Persona,
  type PersonaRepository,
} from '@persona/core';

export interface ListAccountsFilter {
  status?: AccountStatus;
}

export interface EventQuery {
  accountId?: string;
  type?: LifecycleEventType;
  /** YYYY-MM-DD, inclusive */
  startDate?: string;
  /** YYYY-MM-DD, inclusive */
  endDate?: string;
}

export interface ListableAccountRepository extends AccountRepository {
  list(filter?: ListAccountsFilter): Promise<Account[]>;
}

export interface ListablePersonaRepository extends PersonaRepository {
  list(): Promise<Persona[]>;
}

export interface QueryableLifecycleEventStore extends LifecycleEventStore {
  query(filter: EventQuery): Promise<LifecycleEvent[]>;
}

// Everything is stored and returned as a deep copy, so callers can never change stored state.

export class InMemoryAccountRepository implements ListableAccountRepository {
  private readonly items = new Map<string, Account>();

  async getById(id: string): Promise<Account | null> {
    const account = this.items.get(id);
    return account === undefined ? null : structuredClone(account);
  }

  async save(account: Account): Promise<Account> {
    requireId(account.id);
    this.items.set(account.id, structuredClone(account));
    return structuredClone(account);
  }

  /** Accounts ordered by `createdAt`, then by insertion order. */
  async list(filter: ListAccountsFilter = {}): Promise<Account[]> {
    const accounts = [...this.items.values()].filter(
      (account) => filter.status === undefined || account.status === filter.status,
    );
    return sortByTimestamp(accounts, (account) => account.createdAt).map((account) =>
      structuredClone(account),
    );
  }
}

export class InMemoryPersonaRepository implements ListablePersonaRepository {
  private readonly items = new Map<string, Persona>();

  async getById(id: string): Promise<Persona | null> {
    const persona = this.items.get(id);
    return persona === undefined ? null : structuredClone(persona);
  }

  async save(persona: Persona): Promise<Persona> {
    requireId(persona.id);
    this.items.set(persona.id, structuredClone(persona));
    return structuredClone(persona);
  }

  /** Personas in the order they were first saved. */
  async list(): Promise<Persona[]> {
    return [...this.items.values()].map((persona) => structuredClone(persona));
  }
}

export class InMemoryLifecycleEventStore implements QueryableLifecycleEventStore {
  private readonly events: LifecycleEvent[] = [];

  async append(event: LifecycleEvent): Promise<void> {
    requireId(event.id);
    this.events.push(structuredClone(event));
  }

  /** Events of the account ordered by `createdAt`, then by the order they were appended. */
  async findByAccountId(accountId: string): Promise<LifecycleEvent[]> {
    return this.query({ accountId });
  }

  /** Events matching every given field, ordered by `createdAt`, then by the order they were appended. */
  async query(filter: EventQuery): Promise<LifecycleEvent[]> {
    const { startDate, endDate } = filter;
    for (const [field, value] of [
      ['startDate', startDate],
      ['endDate', endDate],
    ] as const) {
      if (value !== undefined && !isValidDateString(value)) {
        throw new ValidationError(`${field} must be a real date in YYYY-MM-DD format`, field);
      }
    }

    const matching = this.events.filter((event) => {
      if (filter.accountId !== undefined && event.accountId !== filter.accountId) {
        return false;
      }
      if (filter.type !== undefined && event.type !== filter.type) {
        return false;
      }
      if (startDate === undefined && endDate === undefined) {
        return true;
      }
      const date = toUtcDateString(event.createdAt);
      return (
        (startDate === undefined || date >= startDate) && (endDate === undefined || date <= endDate)
      );
    });

    return sortByTimestamp(matching, (event) => event.createdAt).map((event) =>
      structuredClone(event),
    );
  }
}

function requireId(id: string): void {
  if (typeof id !== 'string' || id === '') {
    throw new ValidationError('id must be a non-empty string', 'id');
  }
}

/** Stable sort by a timestamp: items with equal (or unparseable) timestamps keep their order. */
function sortByTimestamp<T>(items: readonly T[], timestampOf: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, time: Date.parse(timestampOf(item)) }))
    .sort((a, b) => {
      const byTime = a.time - b.time;
      return byTime !== 0 && !Number.isNaN(byTime) ? byTime : a.index - b.index;
    })
    .map(({ item }) => item);
}
