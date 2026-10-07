import type { IPersonaEngine, ActivityPolicy } from '@persona/core';
import { PersonaEngine, StaticPolicyProvider, defaultRandom } from '@persona/persona-engine';
import {
  ContentPipeline,
  InMemoryContentRepository,
  type ContentRepository,
} from '@persona/publisher';

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
  clock: { now(): Date };
}

export interface CreateContainerOptions {
  policies: Record<string, ActivityPolicy>;
  clock?: { now(): Date };
  rng?: () => number;
}

/** Wires the in-memory storage and the domain engines together. Nothing here touches the network. */
export function createContainer(options: CreateContainerOptions): ControlApiContainer {
  const clock = options.clock ?? { now: () => new Date() };
  const rng = options.rng ?? defaultRandom();

  const accounts = new InMemoryAccountRepository();
  const personas = new InMemoryPersonaRepository();
  const events = new InMemoryLifecycleEventStore();
  const contentRepository = new InMemoryContentRepository();

  return {
    accounts,
    personas,
    events,
    personaEngine: new PersonaEngine({
      accounts,
      personas,
      policyProvider: new StaticPolicyProvider(options.policies),
      rng,
      clock,
    }),
    contentPipeline: new ContentPipeline(contentRepository, { clock }),
    contentRepository,
    clock,
  };
}
