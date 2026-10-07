import type { AnalyticsSnapshot } from '@persona/analytics';
import type { Account, DailyPlan, LifecycleEvent, Persona } from '@persona/core';
import type { ContentItem, ContentPlan } from '@persona/publisher';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, validPersonaBody, type TestClock } from './helpers.js';

let app: FastifyInstance;
let clock: TestClock;

beforeEach(async () => {
  ({ app, clock } = await buildTestApp());
});

afterEach(async () => {
  await app.close();
});

async function send<T>(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  expectedStatus: number,
  payload?: object,
): Promise<T> {
  const response = await app.inject({ method, url, payload });
  expect(response.statusCode, `${method} ${url}: ${response.body}`).toBe(expectedStatus);
  return response.json<T>();
}

describe('portfolio management end to end', () => {
  it('takes an account from creation to a confirmed publication and reports on it', async () => {
    // 1. A persona.
    const persona = await send<Persona>('POST', '/personas', 201, validPersonaBody);

    // 2. An account, connected a few days ago.
    const account = await send<Account>('POST', '/accounts', 201, {
      platform: 'instagram',
      connectedAt: '2026-06-24T08:00:00Z',
      metadata: { source: 'integration' },
    });
    expect(account.status).toBe('connected');

    // 3. The persona is assigned to the account.
    const assigned = await send<Account>('POST', `/accounts/${account.id}/persona`, 200, {
      personaId: persona.id,
    });
    expect(assigned.personaId).toBe(persona.id);

    // 4. The account is moved along a valid path of statuses.
    let current = assigned;
    for (const to of ['onboarding', 'warming', 'active'] as const) {
      clock.advance(60_000);
      current = await send<Account>('POST', `/accounts/${account.id}/transition`, 200, { to });
      expect(current.status).toBe(to);
    }
    expect(current.statusChangedAt).toBe('2026-07-01T12:03:00.000Z');

    // The policy and the plan now follow the active status and the persona.
    const policy = await send<{ stage: string }>('GET', `/accounts/${account.id}/policy`, 200);
    expect(policy.stage).toBe('active');
    const plan = await send<DailyPlan>('GET', `/accounts/${account.id}/plan?date=2026-07-01`, 200);
    expect(plan.isSkipDay).toBe(false);
    expect(plan.sessions.length).toBeGreaterThan(0);

    // 5. A content draft, which inherits the persona of the account.
    const draft = await send<ContentItem>('POST', '/content', 201, {
      accountId: account.id,
      format: 'post',
      brief: 'Seasonal recipe',
      caption: 'Autumn soup',
      topics: ['cooking'],
    });
    expect(draft.personaId).toBe(persona.id);

    // 6. The content is taken to scheduled.
    const path: Record<string, unknown>[] = [
      { to: 'brief_ready' },
      { to: 'planned', plannedDate: '2026-07-02' },
      { to: 'ready' },
      { to: 'scheduled', scheduledAt: '2026-07-02T09:00:00Z' },
    ];
    for (const payload of path) {
      await send<ContentItem>('POST', `/content/${draft.id}/transition`, 200, payload);
    }
    const contentPlan = await send<ContentPlan>(
      'GET',
      `/accounts/${account.id}/content-plan?date=2026-07-02`,
      200,
    );
    expect(contentPlan).toMatchObject({ itemIds: [draft.id], isReady: true });

    // 7. The publication is confirmed: it is only recorded, and has to be confirmed explicitly.
    await send('POST', `/content/${draft.id}/published`, 409, { externalId: 'ext_1' });
    const published = await send<ContentItem>('POST', `/content/${draft.id}/published`, 200, {
      confirm: true,
      externalId: 'ext_1',
    });
    expect(published).toMatchObject({ status: 'published', externalId: 'ext_1' });

    // 8. A restriction is recorded.
    clock.advance(3_600_000);
    const restriction = await send<LifecycleEvent>('POST', '/events', 201, {
      accountId: account.id,
      type: 'restriction_detected',
      payload: { reason: 'rate limit' },
    });
    expect(restriction.createdAt).toBe('2026-07-01T13:03:00.000Z');

    // 9. The analytics snapshot.
    const snapshot = await send<AnalyticsSnapshot>('GET', '/analytics/snapshot', 200);

    // 10. It carries data about the accounts and about the events.
    expect(snapshot.generatedAt).toBe('2026-07-01T13:03:00.000Z');
    expect(snapshot.statusSummary.total).toBe(1);
    expect(snapshot.statusSummary.byStatus.active).toBe(1);
    expect(snapshot.statusSummary.activeRate).toBe(1);
    expect(snapshot.transitionMatrix).toEqual([
      { from: 'connected', to: 'onboarding', count: 1 },
      { from: 'onboarding', to: 'warming', count: 1 },
      { from: 'warming', to: 'active', count: 1 },
    ]);
    expect(snapshot.restrictionFrequency).toEqual([
      { date: '2026-07-01', restrictionEvents: 1, accountsAffected: 1 },
    ]);
    expect(snapshot.cohortSurvival.length).toBeGreaterThan(0);
    expect(snapshot.cohortSurvival.every((point) => point.survivalRate === 1)).toBe(true);

    // The events of the account tell the same story, oldest first.
    const events = await send<LifecycleEvent[]>('GET', `/events?accountId=${account.id}`, 200);
    expect(events.map((event) => event.type)).toEqual([
      'state_changed',
      'state_changed',
      'state_changed',
      'restriction_detected',
    ]);
  });

  it('keeps accounts apart', async () => {
    const first = await send<Account>('POST', '/accounts', 201, { platform: 'telegram' });
    const second = await send<Account>('POST', '/accounts', 201, { platform: 'x' });

    await send('POST', `/accounts/${first.id}/transition`, 200, { to: 'onboarding' });

    const accounts = await send<Account[]>('GET', '/accounts', 200);
    expect(accounts.find((account) => account.id === first.id)?.status).toBe('onboarding');
    expect(accounts.find((account) => account.id === second.id)?.status).toBe('connected');
    expect(await send<LifecycleEvent[]>('GET', `/events?accountId=${second.id}`, 200)).toEqual([]);
  });
});
