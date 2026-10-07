import type {
  Account,
  ActivityPolicy,
  DailyPlan,
  LifecycleEvent,
  PolicyDecision,
} from '@persona/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  anyUuid,
  buildTestApp,
  createAccount,
  createPersona,
  moveAccount,
  TEST_POLICIES,
  TODAY,
  type ErrorBody,
  type TestClock,
} from './helpers.js';

let app: FastifyInstance;
let clock: TestClock;

beforeEach(async () => {
  ({ app, clock } = await buildTestApp());
});

afterEach(async () => {
  await app.close();
});

function transition(accountId: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/accounts/${accountId}/transition`, payload });
}

async function eventsOf(accountId: string): Promise<LifecycleEvent[]> {
  const response = await app.inject({ method: 'GET', url: `/events?accountId=${accountId}` });
  return response.json<LifecycleEvent[]>();
}

describe('POST /accounts', () => {
  it('creates an account in the connected status', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { platform: 'telegram' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<Account>()).toEqual({
      id: anyUuid(),
      platform: 'telegram',
      status: 'connected',
      personaId: null,
      deviceProfileId: null,
      proxyBindingId: null,
      createdAt: '2026-07-01T12:00:00.000Z',
      connectedAt: '2026-07-01T12:00:00.000Z',
      statusChangedAt: '2026-07-01T12:00:00.000Z',
      metadata: {},
    });
  });

  it('generates a different id for every account', async () => {
    const first = await createAccount(app);
    const second = await createAccount(app);

    expect(first.id).not.toBe(second.id);
  });

  it('keeps the given connectedAt and metadata', async () => {
    const account = await createAccount(app, {
      connectedAt: '2026-06-15T08:00:00Z',
      metadata: { source: 'import', tags: ['a'] },
    });

    expect(account.connectedAt).toBe('2026-06-15T08:00:00Z');
    expect(account.metadata).toEqual({ source: 'import', tags: ['a'] });
    expect(account.createdAt).toBe('2026-07-01T12:00:00.000Z');
  });

  it('assigns an existing persona', async () => {
    const persona = await createPersona(app);

    const account = await createAccount(app, { personaId: persona.id });

    expect(account.personaId).toBe(persona.id);
  });

  it('answers 400 for a persona that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { platform: 'telegram', personaId: 'missing' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect(response.json<ErrorBody>().error.details).toEqual([
      { path: ['body', 'personaId'], message: 'persona not found: missing' },
    ]);
  });

  it('does not store an account that was rejected', async () => {
    await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { platform: 'telegram', personaId: 'missing' },
    });

    const list = await app.inject({ method: 'GET', url: '/accounts' });

    expect(list.json()).toEqual([]);
  });

  it.each([
    ['an unknown platform', { platform: 'facebook' }],
    ['a missing platform', {}],
    ['an unknown field', { platform: 'telegram', status: 'active' }],
    [
      'a connectedAt without an offset',
      { platform: 'telegram', connectedAt: '2026-06-15T08:00:00' },
    ],
    ['a connectedAt that is only a date', { platform: 'telegram', connectedAt: '2026-06-15' }],
    ['metadata that is not an object', { platform: 'telegram', metadata: 'x' }],
  ])('answers 400 for %s', async (_label, payload) => {
    const response = await app.inject({ method: 'POST', url: '/accounts', payload });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect(response.json<ErrorBody>().error.details.length).toBeGreaterThan(0);
  });
});

describe('GET /accounts', () => {
  it('lists accounts in the order they were created', async () => {
    const first = await createAccount(app);
    clock.advance(1000);
    const second = await createAccount(app, { platform: 'x' });

    const response = await app.inject({ method: 'GET', url: '/accounts' });

    expect(response.statusCode).toBe(200);
    expect(response.json<Account[]>().map((account) => account.id)).toEqual([first.id, second.id]);
  });

  it('can be filtered by status', async () => {
    const connected = await createAccount(app);
    const moved = await createAccount(app);
    await moveAccount(app, moved.id, ['onboarding']);

    const onboarding = await app.inject({ method: 'GET', url: '/accounts?status=onboarding' });
    const stillConnected = await app.inject({ method: 'GET', url: '/accounts?status=connected' });
    const dead = await app.inject({ method: 'GET', url: '/accounts?status=dead' });

    expect(onboarding.json<Account[]>().map((account) => account.id)).toEqual([moved.id]);
    expect(stillConnected.json<Account[]>().map((account) => account.id)).toEqual([connected.id]);
    expect(dead.json()).toEqual([]);
  });

  it('answers 400 for an unknown status or query parameter', async () => {
    expect((await app.inject({ method: 'GET', url: '/accounts?status=banned' })).statusCode).toBe(
      400,
    );
    expect((await app.inject({ method: 'GET', url: '/accounts?statuz=active' })).statusCode).toBe(
      400,
    );
  });
});

describe('GET /accounts/:accountId', () => {
  it('returns the account', async () => {
    const account = await createAccount(app);

    const response = await app.inject({ method: 'GET', url: `/accounts/${account.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(account);
  });

  it('answers 404 for an unknown account', async () => {
    const response = await app.inject({ method: 'GET', url: '/accounts/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>()).toEqual({
      error: {
        code: 'not_found',
        message: 'account not found: missing',
        details: [{ entity: 'account', id: 'missing' }],
      },
    });
  });
});

describe('POST /accounts/:accountId/transition', () => {
  it('moves the account and returns it', async () => {
    const account = await createAccount(app);
    clock.advance(60_000);

    const response = await transition(account.id, { to: 'onboarding' });

    expect(response.statusCode).toBe(200);
    expect(response.json<Account>()).toEqual({
      ...account,
      status: 'onboarding',
      statusChangedAt: '2026-07-01T12:01:00.000Z',
    });
    const stored = await app.inject({ method: 'GET', url: `/accounts/${account.id}` });
    expect(stored.json<Account>().status).toBe('onboarding');
  });

  it('uses the given moment as statusChangedAt', async () => {
    const account = await createAccount(app);

    const response = await transition(account.id, { to: 'onboarding', at: '2026-07-01T15:30:00Z' });

    expect(response.json<Account>().statusChangedAt).toBe('2026-07-01T15:30:00.000Z');
  });

  it('answers 409 invalid_transition for a transition the state machine forbids', async () => {
    const account = await createAccount(app);

    const response = await transition(account.id, { to: 'active' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    expect(response.json<ErrorBody>().error.details).toEqual([{ from: 'connected', to: 'active' }]);
    const stored = await app.inject({ method: 'GET', url: `/accounts/${account.id}` });
    expect(stored.json<Account>().status).toBe('connected');
    expect(await eventsOf(account.id)).toEqual([]);
  });

  it.each(['onboarding', 'warming', 'active', 'connected'] as const)(
    'refuses to leave limited for %s',
    async (to) => {
      const account = await createAccount(app);
      await moveAccount(app, account.id, ['onboarding', 'warming', 'limited']);

      const response = await transition(account.id, { to, confirm: true });

      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    },
  );

  it('refuses every transition out of dead', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding', 'review', 'dead']);

    const response = await transition(account.id, { to: 'connected', confirm: true });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
  });

  it('answers manual_confirmation_required for review -> warming without confirm', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding', 'review']);

    const response = await transition(account.id, { to: 'warming' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('manual_confirmation_required');
    expect(response.json<ErrorBody>().error.details).toEqual([{ from: 'review', to: 'warming' }]);
    const stored = await app.inject({ method: 'GET', url: `/accounts/${account.id}` });
    expect(stored.json<Account>().status).toBe('review');
  });

  it('treats confirm: false like a missing confirmation', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding', 'review']);

    const response = await transition(account.id, { to: 'warming', confirm: false });

    expect(response.json<ErrorBody>().error.code).toBe('manual_confirmation_required');
  });

  it('performs review -> warming with confirm: true', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding', 'review']);

    const response = await transition(account.id, { to: 'warming', confirm: true });

    expect(response.statusCode).toBe(200);
    expect(response.json<Account>().status).toBe('warming');
  });

  it('does not ask for confirmation when none is needed', async () => {
    const account = await createAccount(app);

    expect((await transition(account.id, { to: 'onboarding' })).statusCode).toBe(200);
  });

  it('checks that the transition is allowed before asking for confirmation', async () => {
    const account = await createAccount(app);

    const response = await transition(account.id, { to: 'warming' });

    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
  });

  it('records a state_changed event for the transition', async () => {
    const account = await createAccount(app);
    clock.advance(5000);

    await transition(account.id, { to: 'onboarding' });

    expect(await eventsOf(account.id)).toEqual([
      {
        id: anyUuid(),
        accountId: account.id,
        type: 'state_changed',
        payload: {
          from: 'connected',
          to: 'onboarding',
          source: 'control-api',
          manualConfirmed: false,
        },
        createdAt: '2026-07-01T12:00:05.000Z',
      },
    ]);
  });

  it('marks a confirmed manual transition in the event', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding', 'review']);

    await transition(account.id, { to: 'warming', confirm: true });

    const events = await eventsOf(account.id);
    expect(events.map((event) => event.payload.manualConfirmed)).toEqual([false, false, true]);
    expect(events.at(-1)?.payload).toMatchObject({ from: 'review', to: 'warming' });
  });

  it('answers 404 for an unknown account', async () => {
    expect((await transition('missing', { to: 'onboarding' })).statusCode).toBe(404);
  });

  it.each([
    ['an unknown status', { to: 'banned' }],
    ['a missing target', {}],
    ['an unknown field', { to: 'onboarding', reason: 'x' }],
    ['an invalid moment', { to: 'onboarding', at: 'yesterday' }],
    ['a confirm that is not a boolean', { to: 'onboarding', confirm: 'yes' }],
  ])('answers 400 for %s', async (_label, payload) => {
    const account = await createAccount(app);

    const response = await transition(account.id, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });
});

describe('POST /accounts/:accountId/persona', () => {
  it('assigns the persona and returns the updated account', async () => {
    const account = await createAccount(app);
    const persona = await createPersona(app);

    const response = await app.inject({
      method: 'POST',
      url: `/accounts/${account.id}/persona`,
      payload: { personaId: persona.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<Account>()).toEqual({ ...account, personaId: persona.id });
    const stored = await app.inject({ method: 'GET', url: `/accounts/${account.id}` });
    expect(stored.json<Account>().personaId).toBe(persona.id);
  });

  it('answers 400 for an unknown persona and leaves the account alone', async () => {
    const account = await createAccount(app);

    const response = await app.inject({
      method: 'POST',
      url: `/accounts/${account.id}/persona`,
      payload: { personaId: 'missing' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    const stored = await app.inject({ method: 'GET', url: `/accounts/${account.id}` });
    expect(stored.json<Account>().personaId).toBeNull();
  });

  it('answers 404 for an unknown account', async () => {
    const persona = await createPersona(app);

    const response = await app.inject({
      method: 'POST',
      url: '/accounts/missing/persona',
      payload: { personaId: persona.id },
    });

    expect(response.statusCode).toBe(404);
  });

  it('answers 400 for a body without personaId', async () => {
    const account = await createAccount(app);

    const response = await app.inject({
      method: 'POST',
      url: `/accounts/${account.id}/persona`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /accounts/:accountId/policy', () => {
  it('returns the policy of the status of the account', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding', 'warming', 'active']);

    const response = await app.inject({ method: 'GET', url: `/accounts/${account.id}/policy` });

    expect(response.statusCode).toBe(200);
    expect(response.json<ActivityPolicy>()).toEqual(TEST_POLICIES.active);
  });

  it('follows the status of the account', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding']);

    const response = await app.inject({ method: 'GET', url: `/accounts/${account.id}/policy` });

    expect(response.json<ActivityPolicy>().stage).toBe('onboarding');
  });

  it('returns the empty policy for a status without one', async () => {
    const account = await createAccount(app);

    const response = await app.inject({ method: 'GET', url: `/accounts/${account.id}/policy` });

    expect(response.json<ActivityPolicy>()).toMatchObject({
      stage: 'none',
      sessionsPerDay: [0, 0],
      skipDayProbability: 1,
    });
  });

  it('answers 404 for an unknown account', async () => {
    expect((await app.inject({ method: 'GET', url: '/accounts/missing/policy' })).statusCode).toBe(
      404,
    );
  });
});

describe('GET /accounts/:accountId/plan', () => {
  async function activeAccountWithPersona(): Promise<Account> {
    const persona = await createPersona(app);
    const account = await createAccount(app, { personaId: persona.id });
    await moveAccount(app, account.id, ['onboarding', 'warming', 'active']);
    return account;
  }

  it('returns the plan of the day', async () => {
    const account = await activeAccountWithPersona();

    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}/plan?date=${TODAY}`,
    });
    const plan = response.json<DailyPlan>();

    expect(response.statusCode).toBe(200);
    expect(plan.accountId).toBe(account.id);
    expect(plan.date).toBe(TODAY);
    expect(plan.isSkipDay).toBe(false);
    expect(plan.sessions.length).toBeGreaterThanOrEqual(2);
    expect(plan.sessions.length).toBeLessThanOrEqual(4);
    expect(plan.actionBudgets).toEqual({ view: 100, like: 25, follow: 8, post: 2, comment: 5 });
    for (const session of plan.sessions) {
      expect(session.startAt.startsWith(TODAY)).toBe(true);
      expect(session.maxDurationMinutes).toBe(30);
    }
  });

  it('returns the same plan when asked again', async () => {
    const account = await activeAccountWithPersona();
    const url = `/accounts/${account.id}/plan?date=${TODAY}`;

    const first = await app.inject({ method: 'GET', url });
    const second = await app.inject({ method: 'GET', url });

    expect(second.json()).toEqual(first.json());
  });

  it('is a skip day for an account without a persona', async () => {
    const account = await createAccount(app);
    await moveAccount(app, account.id, ['onboarding', 'warming', 'active']);

    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}/plan?date=${TODAY}`,
    });

    expect(response.json<DailyPlan>()).toMatchObject({ isSkipDay: true, sessions: [] });
  });

  it.each(['01.07.2026', '2026-7-1', '2026-02-30', ''])(
    'answers 400 for the date %j',
    async (date) => {
      const account = await createAccount(app);

      const response = await app.inject({
        method: 'GET',
        url: `/accounts/${account.id}/plan?date=${date}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    },
  );

  it('answers 400 when the date is missing', async () => {
    const account = await createAccount(app);

    const response = await app.inject({ method: 'GET', url: `/accounts/${account.id}/plan` });

    expect(response.statusCode).toBe(400);
  });

  it('answers 404 for an unknown account', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/accounts/missing/plan?date=${TODAY}`,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /accounts/:accountId/action-permission', () => {
  it('allows an action within the budget of the day', async () => {
    const persona = await createPersona(app);
    const account = await createAccount(app, { personaId: persona.id });
    await moveAccount(app, account.id, ['onboarding', 'warming', 'active']);

    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}/action-permission?action=like`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<PolicyDecision>()).toEqual({
      allowed: true,
      reason: 'allowed',
      remainingBudget: 25,
    });
  });

  it('reports an exhausted budget', async () => {
    const persona = await createPersona(app);
    const account = await createAccount(app, { personaId: persona.id });
    await moveAccount(app, account.id, ['onboarding']);

    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}/action-permission?action=post`,
    });

    expect(response.json<PolicyDecision>()).toEqual({
      allowed: false,
      reason: 'budget_exhausted',
      remainingBudget: 0,
    });
  });

  it('reports a skip day for an account without a persona', async () => {
    const account = await createAccount(app);

    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}/action-permission?action=view`,
    });

    expect(response.json<PolicyDecision>()).toEqual({ allowed: false, reason: 'skip_day' });
  });

  it.each(['share', '', 'LIKE'])('answers 400 for the action %j', async (action) => {
    const account = await createAccount(app);

    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}/action-permission?action=${action}`,
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers 400 when the action is missing and 404 for an unknown account', async () => {
    const account = await createAccount(app);

    expect(
      (await app.inject({ method: 'GET', url: `/accounts/${account.id}/action-permission` }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/accounts/missing/action-permission?action=like' }))
        .statusCode,
    ).toBe(404);
  });
});
