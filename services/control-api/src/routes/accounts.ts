import { randomUUID } from 'node:crypto';

import {
  assertTransition,
  createLifecycleEvent,
  requiresManualReview,
  transitionAccount,
  type Account,
} from '@persona/core';
import type { FastifyInstance } from 'fastify';

import type { ControlApiContainer } from '../container.js';
import { ManualConfirmationRequiredError } from '../errors.js';
import { ensurePersonaReferenced, requireAccount } from '../lookups.js';
import {
  accountParams,
  actionPermissionQuery,
  assignPersonaBody,
  createAccountBody,
  listAccountsQuery,
  planQuery,
  transitionAccountBody,
} from '../schemas/accounts.js';
import { parseRequest } from '../schemas/common.js';

export function registerAccountRoutes(app: FastifyInstance, container: ControlApiContainer): void {
  app.post('/accounts', async (request, reply) => {
    const body = parseRequest('body', createAccountBody, request.body);
    if (body.personaId !== undefined && body.personaId !== null) {
      await ensurePersonaReferenced(container, body.personaId);
    }

    const createdAt = container.clock.now().toISOString();
    const account: Account = {
      id: randomUUID(),
      platform: body.platform,
      status: 'connected',
      personaId: body.personaId ?? null,
      deviceProfileId: null,
      proxyBindingId: null,
      createdAt,
      connectedAt: body.connectedAt ?? createdAt,
      statusChangedAt: createdAt,
      metadata: body.metadata ?? {},
    };

    return reply.code(201).send(await container.accounts.save(account));
  });

  app.get('/accounts', async (request) => {
    const query = parseRequest('query', listAccountsQuery, request.query);
    return container.accounts.list({ status: query.status });
  });

  app.get('/accounts/:accountId', async (request) => {
    const { accountId } = parseRequest('params', accountParams, request.params);
    return requireAccount(container, accountId);
  });

  app.post('/accounts/:accountId/transition', async (request) => {
    const { accountId } = parseRequest('params', accountParams, request.params);
    const body = parseRequest('body', transitionAccountBody, request.body);
    const account = await requireAccount(container, accountId);

    assertTransition(account.status, body.to);
    const needsConfirmation = requiresManualReview(account.status, body.to);
    if (needsConfirmation && body.confirm !== true) {
      throw new ManualConfirmationRequiredError(
        `Moving an account from ${account.status} to ${body.to} is the outcome of a manual review ` +
          'and has to be confirmed with confirm: true',
        [{ from: account.status, to: body.to }],
      );
    }

    const at = body.at === undefined ? container.clock.now() : new Date(body.at);
    const saved = await container.accounts.save(transitionAccount(account, body.to, at));
    await container.events.append(
      createLifecycleEvent({
        accountId,
        type: 'state_changed',
        payload: {
          from: account.status,
          to: body.to,
          source: 'control-api',
          manualConfirmed: needsConfirmation && body.confirm === true,
        },
        createdAt: at,
      }),
    );
    return saved;
  });

  app.post('/accounts/:accountId/persona', async (request) => {
    const { accountId } = parseRequest('params', accountParams, request.params);
    const body = parseRequest('body', assignPersonaBody, request.body);
    await requireAccount(container, accountId);
    await ensurePersonaReferenced(container, body.personaId);

    await container.personaEngine.assignPersona(accountId, body.personaId);
    return requireAccount(container, accountId);
  });

  app.get('/accounts/:accountId/policy', async (request) => {
    const { accountId } = parseRequest('params', accountParams, request.params);
    await requireAccount(container, accountId);
    return container.personaEngine.getPolicy(accountId);
  });

  app.get('/accounts/:accountId/plan', async (request) => {
    const { accountId } = parseRequest('params', accountParams, request.params);
    const query = parseRequest('query', planQuery, request.query);
    await requireAccount(container, accountId);
    return container.personaEngine.getActionPlan(accountId, query.date);
  });

  app.get('/accounts/:accountId/action-permission', async (request) => {
    const { accountId } = parseRequest('params', accountParams, request.params);
    const query = parseRequest('query', actionPermissionQuery, request.query);
    await requireAccount(container, accountId);
    return container.personaEngine.canPerformAction(accountId, query.action);
  });
}
