import type { Account, AccountStatus, ActivityPolicy, Persona } from '@persona/core';
import { createSeededRandom } from '@persona/persona-engine';
import type { ContentItem } from '@persona/publisher';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

import { buildApp, type ControlApiOptions } from '../src/index.js';

/** 2026-07-01 is a Wednesday. */
export const FIXED_NOW = new Date('2026-07-01T12:00:00.000Z');
export const TODAY = '2026-07-01';

export interface TestClock {
  now(): Date;
  set(date: Date): void;
  advance(ms: number): void;
}

export function createTestClock(start: Date = FIXED_NOW): TestClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (date) => {
      current = date.getTime();
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

function makePolicy(overrides: Partial<ActivityPolicy>): ActivityPolicy {
  return {
    stage: 'active',
    maxSessionMinutes: 30,
    sessionsPerDay: [2, 4],
    actions: {
      view: { maxPerDay: 100, probabilityPerEncounter: 1 },
      like: { maxPerDay: 25, probabilityPerEncounter: 0.15 },
      follow: { maxPerDay: 8, probabilityPerEncounter: 0.06 },
      post: { maxPerDay: 2, probabilityPerEncounter: 0.5 },
      comment: { maxPerDay: 5, probabilityPerEncounter: 0.1 },
    },
    minIntervalMinutes: [2, 10],
    // Never a random skip day, so plans do not depend on the rng.
    skipDayProbability: 0,
    ...overrides,
  };
}

/** The minimal set of policies the tests run with. */
export const TEST_POLICIES: Record<string, ActivityPolicy> = {
  onboarding: makePolicy({
    stage: 'onboarding',
    maxSessionMinutes: 5,
    sessionsPerDay: [1, 2],
    actions: {
      view: { maxPerDay: 20, probabilityPerEncounter: 1 },
      like: { maxPerDay: 0, probabilityPerEncounter: 0 },
      follow: { maxPerDay: 0, probabilityPerEncounter: 0 },
      post: { maxPerDay: 0, probabilityPerEncounter: 0 },
      comment: { maxPerDay: 0, probabilityPerEncounter: 0 },
    },
    minIntervalMinutes: [2, 5],
  }),
  warming_week_1: makePolicy({
    stage: 'warming',
    maxSessionMinutes: 10,
    sessionsPerDay: [1, 2],
    actions: {
      view: { maxPerDay: 30, probabilityPerEncounter: 1 },
      like: { maxPerDay: 5, probabilityPerEncounter: 0.08 },
      follow: { maxPerDay: 2, probabilityPerEncounter: 0.03 },
      post: { maxPerDay: 0, probabilityPerEncounter: 0 },
      comment: { maxPerDay: 0, probabilityPerEncounter: 0 },
    },
    minIntervalMinutes: [3, 8],
  }),
  active: makePolicy({ stage: 'active' }),
};

export interface TestApp {
  app: FastifyInstance;
  clock: TestClock;
}

/** An app with fixed clock, deterministic rng and the test policies; logging is off. */
export async function buildTestApp(overrides: Partial<ControlApiOptions> = {}): Promise<TestApp> {
  const clock = createTestClock();
  const app = await buildApp({
    policies: TEST_POLICIES,
    clock,
    rng: createSeededRandom(7),
    logger: false,
    ...overrides,
  });
  return { app, clock };
}

export const validPersonaBody = {
  timezone: 'Europe/Berlin',
  locale: 'en-GB',
  niche: 'cooking',
  tone: 'friendly',
  topics: ['recipes', 'travel'],
  audience: 'home cooks',
  activityWindow: { startHour: 9, endHour: 21, weekendActive: true },
};

export async function createPersona(
  app: FastifyInstance,
  overrides: Record<string, unknown> = {},
): Promise<Persona> {
  const response = await app.inject({
    method: 'POST',
    url: '/personas',
    payload: { ...validPersonaBody, ...overrides },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createPersona failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<Persona>();
}

export async function createAccount(
  app: FastifyInstance,
  overrides: Record<string, unknown> = {},
): Promise<Account> {
  const response = await app.inject({
    method: 'POST',
    url: '/accounts',
    payload: { platform: 'telegram', ...overrides },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createAccount failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<Account>();
}

/** Moves an account along `path`, one confirmed transition at a time. */
export async function moveAccount(
  app: FastifyInstance,
  accountId: string,
  path: readonly AccountStatus[],
): Promise<Account> {
  let account: Account | undefined;
  for (const to of path) {
    const response = await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/transition`,
      payload: { to, confirm: true },
    });
    if (response.statusCode !== 200) {
      throw new Error(
        `moveAccount to ${to} failed: ${String(response.statusCode)} ${response.body}`,
      );
    }
    account = response.json<Account>();
  }
  if (account === undefined) {
    throw new Error('moveAccount needs at least one step');
  }
  return account;
}

export async function createContent(
  app: FastifyInstance,
  accountId: string,
  overrides: Record<string, unknown> = {},
): Promise<ContentItem> {
  const response = await app.inject({
    method: 'POST',
    url: '/content',
    payload: {
      accountId,
      format: 'post',
      brief: 'Seasonal recipe',
      caption: 'Autumn soup',
      topics: ['cooking'],
      ...overrides,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createContent failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<ContentItem>();
}

export async function transitionContent(
  app: FastifyInstance,
  contentId: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: `/content/${contentId}/transition`, payload });
}

/** Brings a draft to `scheduled` for `plannedDate`, the last status before a publication is confirmed. */
export async function scheduleContent(
  app: FastifyInstance,
  contentId: string,
  plannedDate = '2026-07-10',
): Promise<void> {
  const steps: Record<string, unknown>[] = [
    { to: 'brief_ready' },
    { to: 'planned', plannedDate },
    { to: 'ready' },
    { to: 'scheduled', scheduledAt: `${plannedDate}T09:00:00Z` },
  ];
  for (const payload of steps) {
    const response = await transitionContent(app, contentId, payload);
    if (response.statusCode !== 200) {
      throw new Error(`scheduleContent failed: ${String(response.statusCode)} ${response.body}`);
    }
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details: unknown[] };
}

/** Matches the UUID the service generates for an id. */
export function anyUuid(): string {
  return expect.stringMatching(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ) as string;
}
