import type {
  Account,
  AccountRepository,
  IBehaviorEngine,
  IPersonaEngine,
  LifecycleEventStore,
  PersonaRepository,
} from '@persona/core';

export interface SimulatorConfig {
  /** How many simulated milliseconds pass per real millisecond. Default 60 (1 second = 1 minute). */
  speed?: number;
  /** Real time between ticks, in milliseconds. Default 1000. */
  tickIntervalMs?: number;
  /** Stops the simulator by itself after this many ticks. Without it the simulator runs until stopped. */
  maxTicks?: number;
}

export interface SimulatorStatus {
  running: boolean;
  /** ISO 8601; `null` until the simulator has been started. Kept after `stop`. */
  simulatedTime: string | null;
  tickCount: number;
  speed: number;
  tickIntervalMs: number;
  /** Events appended since the last `start`. */
  eventsGenerated: number;
  /** The message of the last error that happened inside a tick, if any. */
  lastError: string | null;
}

/**
 * Chances of the random events. `actionFailure` and `restriction` are per action. The others are per
 * simulated day: a tick that covers less than a day uses the matching share of the chance.
 */
export interface SimulatorProbabilities {
  /** An action ends as `action_failed` instead of `action_performed`. */
  actionFailure: number;
  /** A `restriction_detected` event follows an action. */
  restriction: number;
  /** `warming` to `active`. */
  warmingToActive: number;
  /** `active` to `limited`. */
  activeToLimited: number;
  /** `limited` to `review`. */
  limitedToReview: number;
  /** `review` is resolved: the account leaves it for `warming` or `dead`. */
  reviewResolved: number;
  /** Share of resolved reviews that end in `dead`; the rest return to `warming`. */
  reviewDeadShare: number;
}

/** `AccountRepository` cannot list accounts, which the simulator needs to know whom to process. */
export interface SimulatorAccountRepository extends AccountRepository {
  list(): Promise<Account[]>;
}

export interface SimulatorDependencies {
  accounts: SimulatorAccountRepository;
  personas: PersonaRepository;
  events: LifecycleEventStore;
  personaEngine: IPersonaEngine;
  behaviorEngine: IBehaviorEngine;
  /** Where the simulated time starts. Defaults to the system clock. */
  clock?: { now(): Date };
  /** Source of randomness; pass a seeded one for repeatable runs. */
  rng?: () => number;
  /** Overrides of the default chances. */
  probabilities?: Partial<SimulatorProbabilities>;
}
