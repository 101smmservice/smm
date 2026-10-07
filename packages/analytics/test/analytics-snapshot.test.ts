import {
  ValidationError,
  type Account,
  type AccountStatus,
  type LifecycleEvent,
  type LifecycleEventType,
} from '@persona/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAnalyticsSnapshot } from '../src/index.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');

let counter = 0;

function makeAccount(status: AccountStatus, connectedAt: string): Account {
  counter += 1;
  return {
    id: `acc_${String(counter)}`,
    platform: 'telegram',
    status,
    personaId: null,
    deviceProfileId: null,
    proxyBindingId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    connectedAt,
    statusChangedAt: connectedAt,
    metadata: {},
  };
}

function makeEvent(
  type: LifecycleEventType,
  createdAt: string,
  payload: Record<string, unknown> = {},
): LifecycleEvent {
  counter += 1;
  return { id: `evt_${String(counter)}`, accountId: 'acc_1', type, payload, createdAt };
}

const accounts = [
  makeAccount('active', '2026-07-01T08:00:00.000Z'),
  makeAccount('limited', '2026-07-01T09:00:00.000Z'),
  makeAccount('dead', '2026-07-20T09:00:00.000Z'),
];

const events = [
  makeEvent('state_changed', '2026-06-01T10:00:00.000Z', { from: 'warming', to: 'active' }),
  makeEvent('state_changed', '2026-07-15T10:00:00.000Z', { from: 'active', to: 'limited' }),
  makeEvent('restriction_detected', '2026-06-01T10:00:00.000Z'),
  makeEvent('restriction_detected', '2026-07-15T10:00:00.000Z'),
  makeEvent('action_performed', '2026-06-01T10:00:00.000Z'),
  makeEvent('action_performed', '2026-07-15T10:00:00.000Z'),
  makeEvent('action_failed', '2026-07-15T11:00:00.000Z'),
];

describe('createAnalyticsSnapshot', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('contains every section', () => {
    const snapshot = createAnalyticsSnapshot(accounts, events, { now: NOW });

    expect(Object.keys(snapshot).sort()).toEqual([
      'actionFailureMetrics',
      'cohortSurvival',
      'generatedAt',
      'restrictionFrequency',
      'statusSummary',
      'transitionMatrix',
    ]);
    expect(snapshot.statusSummary.total).toBe(3);
    expect(snapshot.statusSummary.byStatus).toMatchObject({ active: 1, limited: 1, dead: 1 });
    expect(snapshot.transitionMatrix).toEqual([
      { from: 'active', to: 'limited', count: 1 },
      { from: 'warming', to: 'active', count: 1 },
    ]);
    expect(snapshot.restrictionFrequency.map((row) => row.date)).toEqual([
      '2026-06-01',
      '2026-07-15',
    ]);
    expect(snapshot.actionFailureMetrics).toEqual([
      { date: '2026-06-01', performed: 1, failed: 0, failureRate: 0 },
      { date: '2026-07-15', performed: 1, failed: 1, failureRate: 0.5 },
    ]);
    expect(snapshot.cohortSurvival.length).toBeGreaterThan(0);
  });

  it('uses the given now for generatedAt', () => {
    expect(createAnalyticsSnapshot(accounts, events, { now: NOW }).generatedAt).toBe(
      '2026-07-31T12:00:00.000Z',
    );
  });

  it('falls back to the current time for generatedAt and the cohort ages', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T00:00:00.000Z'));

    const snapshot = createAnalyticsSnapshot(accounts, events);

    expect(snapshot.generatedAt).toBe('2026-07-09T00:00:00.000Z');
    expect(snapshot.cohortSurvival.map((point) => point.day)).toEqual([1, 3, 7]);
  });

  it('measures cohort survival at now', () => {
    const snapshot = createAnalyticsSnapshot(accounts, events, { now: NOW, survivalDays: [7] });

    expect(snapshot.cohortSurvival).toEqual([
      { cohortDate: '2026-07-01', day: 7, total: 2, alive: 2, survivalRate: 1 },
      { cohortDate: '2026-07-20', day: 7, total: 1, alive: 0, survivalRate: 0 },
    ]);
  });

  it('applies the range to the daily event metrics', () => {
    const snapshot = createAnalyticsSnapshot(accounts, events, {
      now: NOW,
      range: { startDate: '2026-07-01', endDate: '2026-07-31' },
    });

    expect(snapshot.restrictionFrequency.map((row) => row.date)).toEqual(['2026-07-15']);
    expect(snapshot.actionFailureMetrics.map((row) => row.date)).toEqual(['2026-07-15']);
  });

  it('does not narrow the transition matrix or the account metrics by the range', () => {
    const narrow = createAnalyticsSnapshot(accounts, events, {
      now: NOW,
      range: { startDate: '2026-07-01', endDate: '2026-07-02' },
    });
    const wide = createAnalyticsSnapshot(accounts, events, { now: NOW });

    expect(narrow.transitionMatrix).toEqual(wide.transitionMatrix);
    expect(narrow.statusSummary).toEqual(wide.statusSummary);
    expect(narrow.cohortSurvival).toEqual(wide.cohortSurvival);
    expect(narrow.restrictionFrequency).toEqual([]);
  });

  it('returns a valid, empty snapshot for empty input', () => {
    expect(createAnalyticsSnapshot([], [], { now: NOW })).toEqual({
      generatedAt: '2026-07-31T12:00:00.000Z',
      statusSummary: {
        total: 0,
        byStatus: {
          connected: 0,
          onboarding: 0,
          warming: 0,
          active: 0,
          limited: 0,
          review: 0,
          dead: 0,
        },
        activeRate: 0,
        limitedRate: 0,
        reviewRate: 0,
        deadRate: 0,
      },
      transitionMatrix: [],
      restrictionFrequency: [],
      actionFailureMetrics: [],
      cohortSurvival: [],
    });
  });

  it('does not mutate its input', () => {
    const accountsSnapshot = structuredClone(accounts);
    const eventsSnapshot = structuredClone(events);

    createAnalyticsSnapshot(
      Object.freeze([...accounts]) as Account[],
      Object.freeze([...events]) as LifecycleEvent[],
      {
        now: NOW,
      },
    );

    expect(accounts).toEqual(accountsSnapshot);
    expect(events).toEqual(eventsSnapshot);
  });

  it('rejects an invalid now', () => {
    expect(() => createAnalyticsSnapshot([], [], { now: new Date('nope') })).toThrow(
      ValidationError,
    );
  });

  it('rejects an invalid range', () => {
    expect(() =>
      createAnalyticsSnapshot([], [], { range: { startDate: 'July', endDate: '2026-07-31' } }),
    ).toThrow(ValidationError);
  });
});
