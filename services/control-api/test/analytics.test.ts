import type { AnalyticsSnapshot } from '@persona/analytics';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, createAccount, moveAccount, type ErrorBody } from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildTestApp());
});

afterEach(async () => {
  await app.close();
});

async function snapshot(query = ''): Promise<AnalyticsSnapshot> {
  const response = await app.inject({ method: 'GET', url: `/analytics/snapshot${query}` });
  if (response.statusCode !== 200) {
    throw new Error(`snapshot failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<AnalyticsSnapshot>();
}

function addEvent(accountId: string, type: string, createdAt: string) {
  return app.inject({ method: 'POST', url: '/events', payload: { accountId, type, createdAt } });
}

describe('GET /analytics/snapshot', () => {
  it('returns a snapshot with every section', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding']);

    const result = await snapshot();

    expect(Object.keys(result).sort()).toEqual([
      'actionFailureMetrics',
      'cohortSurvival',
      'generatedAt',
      'publicationMetrics',
      'restrictionFrequency',
      'statusSummary',
      'transitionMatrix',
    ]);
    expect(result.generatedAt).toBe('2026-07-01T12:00:00.000Z');
    expect(result.statusSummary.total).toBe(1);
    expect(result.statusSummary.byStatus.onboarding).toBe(1);
  });

  it('returns a valid, empty snapshot when nothing has been recorded', async () => {
    expect(await snapshot()).toEqual({
      generatedAt: '2026-07-01T12:00:00.000Z',
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
      publicationMetrics: { total: 0, published: 0, failed: 0 },
      cohortSurvival: [],
    });
  });

  it('counts accounts per status', async () => {
    const first = await createAccount(app);
    const second = await createAccount(app);
    await createAccount(app);
    await moveAccount(app, first.id, ['onboarding', 'warming', 'active']);
    await moveAccount(app, second.id, ['onboarding', 'review', 'dead']);

    const { statusSummary } = await snapshot();

    expect(statusSummary.total).toBe(3);
    expect(statusSummary.byStatus).toMatchObject({ connected: 1, active: 1, dead: 1 });
    expect(statusSummary.activeRate).toBeCloseTo(1 / 3, 10);
    expect(statusSummary.deadRate).toBeCloseTo(1 / 3, 10);
  });

  it('builds the transition matrix from the recorded status changes', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding', 'warming', 'limited']);

    const { transitionMatrix } = await snapshot();

    expect(transitionMatrix).toEqual([
      { from: 'connected', to: 'onboarding', count: 1 },
      { from: 'onboarding', to: 'warming', count: 1 },
      { from: 'warming', to: 'limited', count: 1 },
    ]);
  });

  it('lets recorded events influence the metrics', async () => {
    const account = await createAccount(app);
    await addEvent(account.id, 'restriction_detected', '2026-07-01T08:00:00Z');
    await addEvent(account.id, 'restriction_detected', '2026-07-01T09:00:00Z');
    await addEvent(account.id, 'action_performed', '2026-07-01T10:00:00Z');
    await addEvent(account.id, 'action_performed', '2026-07-01T10:05:00Z');
    await addEvent(account.id, 'action_performed', '2026-07-01T10:10:00Z');
    await addEvent(account.id, 'action_failed', '2026-07-01T10:15:00Z');

    const result = await snapshot();

    expect(result.restrictionFrequency).toEqual([
      { date: '2026-07-01', restrictionEvents: 2, accountsAffected: 1 },
    ]);
    expect(result.actionFailureMetrics).toEqual([
      { date: '2026-07-01', performed: 3, failed: 1, failureRate: 0.25 },
    ]);
  });

  it('applies the date range to the daily event metrics', async () => {
    const account = await createAccount(app);
    await addEvent(account.id, 'restriction_detected', '2026-06-01T08:00:00Z');
    await addEvent(account.id, 'restriction_detected', '2026-06-15T08:00:00Z');
    await addEvent(account.id, 'action_failed', '2026-06-15T09:00:00Z');
    await addEvent(account.id, 'restriction_detected', '2026-06-30T08:00:00Z');

    const result = await snapshot('?startDate=2026-06-10&endDate=2026-06-20');

    expect(result.restrictionFrequency.map((row) => row.date)).toEqual(['2026-06-15']);
    expect(result.actionFailureMetrics.map((row) => row.date)).toEqual(['2026-06-15']);
  });

  it('accepts a range with only one end', async () => {
    const account = await createAccount(app);
    await addEvent(account.id, 'restriction_detected', '2026-06-01T08:00:00Z');
    await addEvent(account.id, 'restriction_detected', '2026-06-20T08:00:00Z');

    const from = await snapshot('?startDate=2026-06-10');
    const until = await snapshot('?endDate=2026-06-10');

    expect(from.restrictionFrequency.map((row) => row.date)).toEqual(['2026-06-20']);
    expect(until.restrictionFrequency.map((row) => row.date)).toEqual(['2026-06-01']);
  });

  it('does not narrow the account metrics by the range', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding']);

    const result = await snapshot('?startDate=2030-01-01&endDate=2030-01-31');

    expect(result.statusSummary.total).toBe(1);
    expect(result.transitionMatrix).toHaveLength(1);
  });

  describe('survivalDays', () => {
    async function seedCohort(): Promise<void> {
      const alive = await createAccount(app, { connectedAt: '2026-06-20T08:00:00Z' });
      const dead = await createAccount(app, { connectedAt: '2026-06-20T09:00:00Z' });
      await moveAccount(app, alive.id, ['onboarding']);
      await moveAccount(app, dead.id, ['onboarding', 'review', 'dead']);
    }

    it('is parsed from a comma-separated string', async () => {
      await seedCohort();

      const { cohortSurvival } = await snapshot('?survivalDays=1,3,7');

      expect(cohortSurvival).toEqual([
        { cohortDate: '2026-06-20', day: 1, total: 2, alive: 1, survivalRate: 0.5 },
        { cohortDate: '2026-06-20', day: 3, total: 2, alive: 1, survivalRate: 0.5 },
        { cohortDate: '2026-06-20', day: 7, total: 2, alive: 1, survivalRate: 0.5 },
      ]);
    });

    it('tolerates spaces and repeated values', async () => {
      await seedCohort();

      const { cohortSurvival } = await snapshot(`?survivalDays=${encodeURIComponent('3, 1,3')}`);

      expect(cohortSurvival.map((point) => point.day)).toEqual([1, 3]);
    });

    it('only reports the ages a cohort has reached', async () => {
      await seedCohort();

      const { cohortSurvival } = await snapshot('?survivalDays=7,30');

      expect(cohortSurvival.map((point) => point.day)).toEqual([7]);
    });

    it('defaults to 1, 3, 7, 14 and 30 days', async () => {
      await createAccount(app, { connectedAt: '2026-05-01T08:00:00Z' });

      const { cohortSurvival } = await snapshot();

      expect(cohortSurvival.map((point) => point.day)).toEqual([1, 3, 7, 14, 30]);
    });

    it.each(['0', '-1', '1.5', 'a', '1,,3', '1,x', ',', ' '])(
      'answers 400 for %j',
      async (value) => {
        const response = await app.inject({
          method: 'GET',
          url: `/analytics/snapshot?survivalDays=${encodeURIComponent(value)}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>().error.code).toBe('validation_error');
      },
    );

    it('answers 400 for an empty value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/analytics/snapshot?survivalDays=',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  it.each(['2026-02-30', '01.07.2026', '2026-7-1', 'yesterday'])(
    'answers 400 for the date %j',
    async (date) => {
      for (const field of ['startDate', 'endDate']) {
        const response = await app.inject({
          method: 'GET',
          url: `/analytics/snapshot?${field}=${date}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>().error.code).toBe('validation_error');
      }
    },
  );

  it('answers 400 for a reversed range or an unknown parameter', async () => {
    for (const query of ['?startDate=2026-07-03&endDate=2026-07-01', '?window=7']) {
      const response = await app.inject({ method: 'GET', url: `/analytics/snapshot${query}` });

      expect(response.statusCode).toBe(400);
    }
  });
});
