import {
  InMemoryIntakeRepository,
  IntakeService,
  type IntakeRepository,
} from '@persona/account-intake';
import { BehaviorEngine } from '@persona/behavior';
import type { IPersonaEngine, ActivityPolicy } from '@persona/core';
import { PersonaEngine, StaticPolicyProvider, defaultRandom } from '@persona/persona-engine';
import {
  ContentPipeline,
  InMemoryContentRepository,
  type ContentRepository,
} from '@persona/publisher';
import { PortfolioSimulator, type SimulatorProbabilities } from '@persona/simulator';

import {
  InMemoryAccountRepository,
  InMemoryLifecycleEventStore,
  InMemoryPersonaRepository,
  type ListableAccountRepository,
  type ListablePersonaRepository,
  type QueryableLifecycleEventStore,
} from './storage/in-memory.js';

export interface ControlApiContainer {
  accounts: ListableAccountRepository;
  personas: ListablePersonaRepository;
  events: QueryableLifecycleEventStore;
  personaEngine: IPersonaEngine;
  contentPipeline: ContentPipeline;
  contentRepository: ContentRepository;
  intakeRepository: IntakeRepository;
  intakeService: IntakeService;
  /** Created with the container but not started; see `POST /simulator/start`. */
  simulator: PortfolioSimulator;
  clock: { now(): Date };
}

export interface CreateContainerOptions {
  policies: Record<string, ActivityPolicy>;
  clock?: { now(): Date };
  rng?: () => number;
  /** Overrides of the default chances of the activity simulator. */
  simulatorProbabilities?: Partial<SimulatorProbabilities>;
}

/** Wires the in-memory storage and the domain engines together. Nothing here touches the network. */
export function createContainer(options: CreateContainerOptions): ControlApiContainer {
  const clock = options.clock ?? { now: () => new Date() };
  const rng = options.rng ?? defaultRandom();

  const accounts = new InMemoryAccountRepository();
  const personas = new InMemoryPersonaRepository();
  const events = new InMemoryLifecycleEventStore();
  const contentRepository = new InMemoryContentRepository();
  const intakeRepository = new InMemoryIntakeRepository();

  const personaEngine = new PersonaEngine({
    accounts,
    personas,
    policyProvider: new StaticPolicyProvider(options.policies),
    rng,
    clock,
  });

  const contentPipeline = new ContentPipeline(contentRepository, { clock });

  return {
    accounts,
    personas,
    events,
    personaEngine,
    contentPipeline,
    contentRepository,
    intakeRepository,
    intakeService: new IntakeService({
      repository: intakeRepository,
      accounts,
      personas,
      events,
      clock,
    }),
    simulator: new PortfolioSimulator({
      accounts,
      personas,
      events,
      personaEngine,
      behaviorEngine: new BehaviorEngine({ rng }),
      contentPipeline,
      clock,
      rng,
      probabilities: options.simulatorProbabilities,
    }),
    clock,
  };
}
