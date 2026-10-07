import type { IntakeRequest } from '@persona/account-intake';
import type { Account, LifecycleEvent } from '@persona/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anyUuid, buildTestApp, createPersona, type ErrorBody, type TestClock } from './helpers.js';

let app: FastifyInstance;
let clock: TestClock;

beforeEach(async () => {
  ({ app, clock } = await buildTestApp());
});

afterEach(async () => {
  await app.close();
});

interface Completed {
  request: IntakeRequest;
  account: Account;
}

function post(url: string, payload?: unknown) {
  return app.inject({
    method: 'POST',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function createRequest(overrides: Record<string, unknown> = {}): Promise<IntakeRequest> {
  const response = await post('/intake/requests', {
    platform: 'telegram',
    externalAccountId: 'ext_1',
    externalUsername: 'someone',
    ...overrides,
  });
  if (response.statusCode !== 201) {
    throw new Error(`createRequest failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<IntakeRequest>();
}

async function submitted(overrides: Record<string, unknown> = {}): Promise<IntakeRequest> {
  const request = await createRequest(overrides);
  const response = await post(`/intake/requests/${request.id}/submit`, {
    ownershipConfirmed: true,
  });
  return response.json<IntakeRequest>();
}

async function approved(overrides: Record<string, unknown> = {}): Promise<IntakeRequest> {
  const request = await submitted(overrides);
  const response = await post(`/intake/requests/${request.id}/approve`, { confirmOwnership: true });
  if (response.statusCode !== 200) {
    throw new Error(`approve failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<IntakeRequest>();
}

async function getRequest(requestId: string): Promise<IntakeRequest> {
  const response = await app.inject({ method: 'GET', url: `/intake/requests/${requestId}` });
  return response.json<IntakeRequest>();
}

describe('POST /intake/requests', () => {
  it('creates a request in the draft status', async () => {
    const response = await post('/intake/requests', {
      platform: 'telegram',
      externalAccountId: 'ext_1',
      externalUsername: 'someone',
      source: 'import',
      desiredPersonaId: 'persona_1',
      notes: 'from the spreadsheet',
      metadata: { batch: 7 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<IntakeRequest>()).toEqual({
      id: anyUuid(),
      platform: 'telegram',
      externalAccountId: 'ext_1',
      externalUsername: 'someone',
      source: 'import',
      desiredPersonaId: 'persona_1',
      ownershipConfirmed: false,
      notes: 'from the spreadsheet',
      status: 'draft',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z',
      submittedAt: null,
      reviewedAt: null,
      completedAt: null,
      rejectionReason: null,
      completedAccountId: null,
      metadata: { batch: 7 },
    });
  });

  it('needs nothing but a platform and applies the defaults', async () => {
    const response = await post('/intake/requests', { platform: 'x' });

    expect(response.statusCode).toBe(201);
    expect(response.json<IntakeRequest>()).toMatchObject({
      platform: 'x',
      source: 'manual',
      ownershipConfirmed: false,
      externalAccountId: null,
      externalUsername: null,
      desiredPersonaId: null,
      notes: null,
      metadata: {},
    });
  });

  it('generates a different id for every request', async () => {
    const first = await createRequest();
    const second = await createRequest();

    expect(first.id).not.toBe(second.id);
  });

  it('stores the request so that it can be read back', async () => {
    const request = await createRequest();

    expect(await getRequest(request.id)).toEqual(request);
  });

  it.each([
    ['an invalid platform', { platform: 'facebook' }],
    ['a missing platform', {}],
    ['an unknown field', { platform: 'telegram', status: 'approved' }],
    [
      'an unknown field that tries to confirm ownership',
      { platform: 'telegram', ownershipConfirmed: true },
    ],
    ['an unknown source', { platform: 'telegram', source: 'scrape' }],
    ['an empty externalAccountId', { platform: 'telegram', externalAccountId: '' }],
    ['a blank externalUsername', { platform: 'telegram', externalUsername: '   ' }],
    ['metadata that is not an object', { platform: 'telegram', metadata: 'x' }],
  ])('answers 400 for %s', async (_label, payload) => {
    const response = await post('/intake/requests', payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect(response.json<ErrorBody>().error.details.length).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/intake/requests' })).json()).toEqual([]);
  });
});

describe('GET /intake/requests', () => {
  it('lists the requests in the order they were created', async () => {
    const first = await createRequest({ externalAccountId: 'a' });
    clock.advance(1000);
    const second = await createRequest({ externalAccountId: 'b' });

    const response = await app.inject({ method: 'GET', url: '/intake/requests' });

    expect(response.statusCode).toBe(200);
    expect(response.json<IntakeRequest[]>().map((request) => request.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('returns an empty list at first', async () => {
    expect((await app.inject({ method: 'GET', url: '/intake/requests' })).json()).toEqual([]);
  });

  it('sorts requests of every status together by creation time', async () => {
    const early = await createRequest({ externalAccountId: 'a' });
    clock.advance(1000);
    const middle = await createRequest({ externalAccountId: 'b' });
    clock.advance(1000);
    const late = await createRequest({ externalAccountId: 'c' });
    await post(`/intake/requests/${early.id}/submit`, { ownershipConfirmed: true });
    await post(`/intake/requests/${late.id}/submit`, { ownershipConfirmed: true });

    const ids = (await app.inject({ method: 'GET', url: '/intake/requests' }))
      .json<IntakeRequest[]>()
      .map((request) => request.id);

    expect(ids).toEqual([early.id, middle.id, late.id]);
  });

  it('can be filtered by status', async () => {
    const draft = await createRequest({ externalAccountId: 'a' });
    const pending = await submitted({ externalAccountId: 'b' });

    const drafts = await app.inject({ method: 'GET', url: '/intake/requests?status=draft' });
    const pendings = await app.inject({
      method: 'GET',
      url: '/intake/requests?status=pending_review',
    });
    const completed = await app.inject({ method: 'GET', url: '/intake/requests?status=completed' });

    expect(drafts.json<IntakeRequest[]>().map((request) => request.id)).toEqual([draft.id]);
    expect(pendings.json<IntakeRequest[]>().map((request) => request.id)).toEqual([pending.id]);
    expect(completed.json()).toEqual([]);
  });

  it.each(['invalid', 'DRAFT', ''])('answers 400 for the status %j', async (status) => {
    const response = await app.inject({ method: 'GET', url: `/intake/requests?status=${status}` });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });

  it('answers 400 for an unknown query parameter', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/intake/requests?state=draft' })).statusCode,
    ).toBe(400);
  });
});

describe('GET /intake/requests/:requestId', () => {
  it('returns the request', async () => {
    const request = await createRequest();

    const response = await app.inject({ method: 'GET', url: `/intake/requests/${request.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(request);
  });

  it('answers 404 for an unknown request', async () => {
    const response = await app.inject({ method: 'GET', url: '/intake/requests/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>()).toEqual({
      error: {
        code: 'not_found',
        message: 'Intake request not found: missing',
        details: [{ entity: 'intake_request', id: 'missing' }],
      },
    });
  });
});

describe('POST /intake/requests/:requestId/submit', () => {
  it('moves the request to pending_review and records the confirmation', async () => {
    const request = await createRequest();
    clock.advance(60_000);

    const response = await post(`/intake/requests/${request.id}/submit`, {
      ownershipConfirmed: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<IntakeRequest>()).toMatchObject({
      status: 'pending_review',
      ownershipConfirmed: true,
      submittedAt: '2026-07-01T12:01:00.000Z',
      updatedAt: '2026-07-01T12:01:00.000Z',
    });
    expect((await getRequest(request.id)).status).toBe('pending_review');
  });

  it.each([
    ['without ownershipConfirmed', {}],
    ['with ownershipConfirmed: false', { ownershipConfirmed: false }],
    ['with ownershipConfirmed that is not a boolean', { ownershipConfirmed: 'yes' }],
    ['with an unknown field', { ownershipConfirmed: true, confirm: true }],
  ])('answers 400 %s', async (_label, payload) => {
    const request = await createRequest();

    const response = await post(`/intake/requests/${request.id}/submit`, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect(await getRequest(request.id)).toMatchObject({
      status: 'draft',
      ownershipConfirmed: false,
    });
  });

  it('answers 400 when no body is sent at all', async () => {
    const request = await createRequest();

    const response = await post(`/intake/requests/${request.id}/submit`);

    expect(response.statusCode).toBe(400);
  });

  it('answers 404 for an unknown request', async () => {
    const response = await post('/intake/requests/missing/submit', { ownershipConfirmed: true });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('not_found');
  });

  it('answers 409 invalid_transition for a request that was already submitted', async () => {
    const request = await submitted();

    const response = await post(`/intake/requests/${request.id}/submit`, {
      ownershipConfirmed: true,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    expect(response.json<ErrorBody>().error.details).toEqual([
      { from: 'pending_review', to: 'pending_review' },
    ]);
  });
});

describe('POST /intake/requests/:requestId/approve', () => {
  it('answers manual_confirmation_required without confirmOwnership: true', async () => {
    const request = await submitted();

    for (const payload of [{}, { confirmOwnership: false }]) {
      const response = await post(`/intake/requests/${request.id}/approve`, payload);

      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error.code).toBe('manual_confirmation_required');
      expect(response.json<ErrorBody>().error.details).toEqual([
        { from: 'pending_review', to: 'approved' },
      ]);
    }
    expect(await getRequest(request.id)).toMatchObject({
      status: 'pending_review',
      reviewedAt: null,
    });
  });

  it('answers manual_confirmation_required when no body is sent at all', async () => {
    const request = await submitted();

    const response = await post(`/intake/requests/${request.id}/approve`);

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('manual_confirmation_required');
  });

  it('moves the request to approved with confirmOwnership: true', async () => {
    const request = await submitted();
    clock.advance(120_000);

    const response = await post(`/intake/requests/${request.id}/approve`, {
      confirmOwnership: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<IntakeRequest>()).toMatchObject({
      status: 'approved',
      reviewedAt: '2026-07-01T12:02:00.000Z',
    });
  });

  it('keeps the reviewer note', async () => {
    const request = await submitted();

    const response = await post(`/intake/requests/${request.id}/approve`, {
      confirmOwnership: true,
      reviewerNote: 'verified with the owner',
    });

    expect(response.json<IntakeRequest>().metadata).toEqual({
      reviewerNote: 'verified with the owner',
    });
  });

  it('answers 404 for an unknown request', async () => {
    const response = await post('/intake/requests/missing/approve', { confirmOwnership: true });

    expect(response.statusCode).toBe(404);
  });

  it('answers 409 invalid_transition, not manual_confirmation_required, for a draft', async () => {
    const request = await createRequest();

    for (const payload of [{ confirmOwnership: true }, {}]) {
      const response = await post(`/intake/requests/${request.id}/approve`, payload);

      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    }
  });

  it.each([
    ['a confirmOwnership that is not a boolean', { confirmOwnership: 'yes' }],
    ['an unknown field', { confirmOwnership: true, confirm: true }],
    ['a blank reviewerNote', { confirmOwnership: true, reviewerNote: '  ' }],
  ])('answers 400 for %s', async (_label, payload) => {
    const request = await submitted();

    const response = await post(`/intake/requests/${request.id}/approve`, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect((await getRequest(request.id)).status).toBe('pending_review');
  });
});

describe('POST /intake/requests/:requestId/reject', () => {
  it('moves a request under review to rejected, with the reason', async () => {
    const request = await submitted();
    clock.advance(60_000);

    const response = await post(`/intake/requests/${request.id}/reject`, {
      reason: 'ownership could not be verified',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<IntakeRequest>()).toMatchObject({
      status: 'rejected',
      rejectionReason: 'ownership could not be verified',
      reviewedAt: '2026-07-01T12:01:00.000Z',
    });
  });

  it('moves an approved request to rejected too', async () => {
    const request = await approved();

    const response = await post(`/intake/requests/${request.id}/reject`, {
      reason: 'changed mind',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<IntakeRequest>().status).toBe('rejected');
  });

  it.each([
    ['no reason', {}],
    ['an empty reason', { reason: '' }],
    ['a blank reason', { reason: '   ' }],
    ['a reason that is not a string', { reason: 5 }],
    ['an unknown field', { reason: 'x', note: 'y' }],
  ])('answers 400 for %s', async (_label, payload) => {
    const request = await submitted();

    const response = await post(`/intake/requests/${request.id}/reject`, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect(await getRequest(request.id)).toMatchObject({
      status: 'pending_review',
      rejectionReason: null,
    });
  });

  it('answers 404 for an unknown request', async () => {
    expect((await post('/intake/requests/missing/reject', { reason: 'x' })).statusCode).toBe(404);
  });

  it('answers 409 invalid_transition for a draft', async () => {
    const request = await createRequest();

    const response = await post(`/intake/requests/${request.id}/reject`, { reason: 'x' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
  });
});

describe('POST /intake/requests/:requestId/reopen', () => {
  async function rejected(): Promise<IntakeRequest> {
    const request = await submitted();
    const response = await post(`/intake/requests/${request.id}/reject`, {
      reason: 'wrong username',
    });
    return response.json<IntakeRequest>();
  }

  it('moves rejected -> draft and clears the reason', async () => {
    const request = await rejected();
    expect(request.rejectionReason).toBe('wrong username');

    const response = await post(`/intake/requests/${request.id}/reopen`, {});

    expect(response.statusCode).toBe(200);
    expect(response.json<IntakeRequest>()).toMatchObject({
      status: 'draft',
      rejectionReason: null,
    });
  });

  it('needs no body', async () => {
    const request = await rejected();

    const response = await post(`/intake/requests/${request.id}/reopen`);

    expect(response.statusCode).toBe(200);
    expect(response.json<IntakeRequest>().status).toBe('draft');
  });

  it('lets the reopened request be submitted again', async () => {
    const request = await rejected();
    await post(`/intake/requests/${request.id}/reopen`);

    const response = await post(`/intake/requests/${request.id}/submit`, {
      ownershipConfirmed: true,
    });

    expect(response.json<IntakeRequest>().status).toBe('pending_review');
  });

  it('answers 400 for a body with fields', async () => {
    const request = await rejected();

    const response = await post(`/intake/requests/${request.id}/reopen`, { reason: 'x' });

    expect(response.statusCode).toBe(400);
    expect((await getRequest(request.id)).status).toBe('rejected');
  });

  it('answers 404 for an unknown request', async () => {
    expect((await post('/intake/requests/missing/reopen')).statusCode).toBe(404);
  });

  it.each(['draft', 'pending_review', 'approved'] as const)(
    'answers 409 invalid_transition for a request in the %s status',
    async (status) => {
      const request =
        status === 'draft'
          ? await createRequest()
          : status === 'pending_review'
            ? await submitted()
            : await approved();

      const response = await post(`/intake/requests/${request.id}/reopen`);

      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    },
  );
});

describe('POST /intake/requests/:requestId/complete', () => {
  it('creates an account and returns the request together with it', async () => {
    const request = await approved();
    clock.advance(3_600_000);

    const response = await post(`/intake/requests/${request.id}/complete`, {});
    const result = response.json<Completed>();

    expect(response.statusCode).toBe(200);
    expect(Object.keys(result).sort()).toEqual(['account', 'request']);
    expect(result.request).toMatchObject({
      id: request.id,
      status: 'completed',
      completedAt: '2026-07-01T13:00:00.000Z',
      completedAccountId: result.account.id,
    });
    expect(result.account).toEqual({
      id: anyUuid(),
      platform: 'telegram',
      status: 'connected',
      personaId: null,
      deviceProfileId: null,
      proxyBindingId: null,
      createdAt: '2026-07-01T13:00:00.000Z',
      connectedAt: '2026-07-01T13:00:00.000Z',
      statusChangedAt: '2026-07-01T13:00:00.000Z',
      metadata: {
        intakeRequestId: request.id,
        intakeSource: 'manual',
        externalAccountId: 'ext_1',
        externalUsername: 'someone',
      },
    });
  });

  it('needs no body', async () => {
    const request = await approved();

    const response = await post(`/intake/requests/${request.id}/complete`);

    expect(response.statusCode).toBe(200);
  });

  it('creates an account in the connected status that the rest of the service can see', async () => {
    const request = await approved();
    const { account } = (await post(`/intake/requests/${request.id}/complete`)).json<Completed>();

    const read = await app.inject({ method: 'GET', url: `/accounts/${account.id}` });
    const connected = await app.inject({ method: 'GET', url: '/accounts?status=connected' });

    expect(read.json<Account>().status).toBe('connected');
    expect(connected.json<Account[]>().map((candidate) => candidate.id)).toEqual([account.id]);
  });

  it('keeps the link to the request in metadata.intakeRequestId', async () => {
    const request = await approved();

    const { account } = (await post(`/intake/requests/${request.id}/complete`)).json<Completed>();

    expect(account.metadata.intakeRequestId).toBe(request.id);
  });

  it('saves the account on the request', async () => {
    const request = await approved();
    const { account } = (await post(`/intake/requests/${request.id}/complete`)).json<Completed>();

    expect((await getRequest(request.id)).completedAccountId).toBe(account.id);
  });

  it('uses the persona the request asked for', async () => {
    const persona = await createPersona(app);
    const request = await approved({ desiredPersonaId: persona.id });

    const { account } = (await post(`/intake/requests/${request.id}/complete`)).json<Completed>();

    expect(account.personaId).toBe(persona.id);
  });

  it('prefers the persona given when completing', async () => {
    const asked = await createPersona(app);
    const chosen = await createPersona(app, { niche: 'travel' });
    const request = await approved({ desiredPersonaId: asked.id });

    const { account } = (
      await post(`/intake/requests/${request.id}/complete`, { personaId: chosen.id })
    ).json<Completed>();

    expect(account.personaId).toBe(chosen.id);
  });

  it('answers 400 for a persona that does not exist and creates nothing', async () => {
    const request = await approved();

    const response = await post(`/intake/requests/${request.id}/complete`, {
      personaId: 'missing',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect((await app.inject({ method: 'GET', url: '/accounts' })).json()).toEqual([]);
    expect((await getRequest(request.id)).status).toBe('approved');
  });

  it('answers 400 when the persona the request asked for does not exist', async () => {
    const request = await approved({ desiredPersonaId: 'missing' });

    const response = await post(`/intake/requests/${request.id}/complete`);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });

  it.each([
    ['a blank personaId', { personaId: '' }],
    ['an unknown field', { account: 'x' }],
  ])('answers 400 for %s', async (_label, payload) => {
    const request = await approved();

    expect((await post(`/intake/requests/${request.id}/complete`, payload)).statusCode).toBe(400);
  });

  it.each(['draft', 'pending_review', 'rejected'] as const)(
    'answers 409 invalid_transition for a request in the %s status',
    async (status) => {
      const request =
        status === 'draft'
          ? await createRequest()
          : status === 'pending_review'
            ? await submitted()
            : (
                await post(`/intake/requests/${(await submitted()).id}/reject`, { reason: 'x' })
              ).json<IntakeRequest>();

      const response = await post(`/intake/requests/${request.id}/complete`);

      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
      expect((await app.inject({ method: 'GET', url: '/accounts' })).json()).toEqual([]);
    },
  );

  it('answers 409 invalid_transition when the same request is completed again', async () => {
    const request = await approved();
    await post(`/intake/requests/${request.id}/complete`);

    const response = await post(`/intake/requests/${request.id}/complete`);

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('invalid_transition');
    expect(response.json<ErrorBody>().error.details).toEqual([
      { from: 'completed', to: 'completed' },
    ]);
    expect((await app.inject({ method: 'GET', url: '/accounts' })).json()).toHaveLength(1);
  });

  it('answers 409 duplicate_intake for a second request for the same external account', async () => {
    const first = await approved();
    await post(`/intake/requests/${first.id}/complete`);
    const second = await approved();

    const response = await post(`/intake/requests/${second.id}/complete`);

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('duplicate_intake');
    expect(response.json<ErrorBody>().error.details).toEqual([
      { platform: 'telegram', externalAccountId: 'ext_1', existingRequestId: first.id },
    ]);
    expect((await app.inject({ method: 'GET', url: '/accounts' })).json()).toHaveLength(1);
    expect((await getRequest(second.id)).status).toBe('approved');
  });

  it('allows the same external id on another platform', async () => {
    const telegram = await approved();
    const x = await approved({ platform: 'x' });
    await post(`/intake/requests/${telegram.id}/complete`);

    expect((await post(`/intake/requests/${x.id}/complete`)).statusCode).toBe(200);
  });

  it('completes only one of two overlapping requests for the same external account', async () => {
    const first = await approved();
    const second = await approved();

    const responses = await Promise.all([
      post(`/intake/requests/${first.id}/complete`),
      post(`/intake/requests/${second.id}/complete`),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await app.inject({ method: 'GET', url: '/accounts' })).json()).toHaveLength(1);
  });

  it('completes a request only once when asked twice at the same time', async () => {
    const request = await approved();

    const responses = await Promise.all([
      post(`/intake/requests/${request.id}/complete`),
      post(`/intake/requests/${request.id}/complete`),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await app.inject({ method: 'GET', url: '/accounts' })).json()).toHaveLength(1);
  });

  it('answers 404 for an unknown request', async () => {
    expect((await post('/intake/requests/missing/complete')).statusCode).toBe(404);
  });

  it('records a state_changed event that GET /events returns', async () => {
    const request = await approved();
    clock.advance(1000);

    const { account } = (await post(`/intake/requests/${request.id}/complete`)).json<Completed>();

    const events = (
      await app.inject({ method: 'GET', url: `/events?accountId=${account.id}&type=state_changed` })
    ).json<LifecycleEvent[]>();
    expect(events).toEqual([
      {
        id: anyUuid(),
        accountId: account.id,
        type: 'state_changed',
        payload: {
          from: null,
          to: 'connected',
          source: 'account-intake',
          intakeRequestId: request.id,
        },
        createdAt: '2026-07-01T12:00:01.000Z',
      },
    ]);
  });
});

describe('intake together with the rest of the service', () => {
  it('turns a request into an account that can be managed like any other', async () => {
    const persona = await createPersona(app);
    const request = await approved({ desiredPersonaId: persona.id });
    const { account } = (await post(`/intake/requests/${request.id}/complete`)).json<Completed>();

    const moved = await post(`/accounts/${account.id}/transition`, { to: 'onboarding' });
    const policy = await app.inject({ method: 'GET', url: `/accounts/${account.id}/policy` });
    const snapshot = await app.inject({ method: 'GET', url: '/analytics/snapshot' });

    expect(moved.statusCode).toBe(200);
    expect(policy.json<{ stage: string }>().stage).toBe('onboarding');
    expect(snapshot.json<{ statusSummary: { total: number } }>().statusSummary.total).toBe(1);
  });

  it('lists the intake routes at GET /api', async () => {
    const { routes } = (await app.inject({ method: 'GET', url: '/api' })).json<{
      routes: { method: string; path: string }[];
    }>();

    expect(routes.filter((route) => route.path.startsWith('/intake/'))).toHaveLength(8);
  });
});
