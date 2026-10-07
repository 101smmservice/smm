import { createLifecycleEvent } from '@persona/core';
import type { FastifyInstance } from 'fastify';

import type { ControlApiContainer } from '../container.js';
import { requireAccount } from '../lookups.js';
import { parseRequest } from '../schemas/common.js';
import { createEventBody, listEventsQuery } from '../schemas/events.js';

export function registerEventRoutes(app: FastifyInstance, container: ControlApiContainer): void {
  app.post('/events', async (request, reply) => {
    const body = parseRequest('body', createEventBody, request.body);
    await requireAccount(container, body.accountId);

    const event = createLifecycleEvent({
      accountId: body.accountId,
      type: body.type,
      payload: body.payload,
      createdAt: body.createdAt === undefined ? container.clock.now() : new Date(body.createdAt),
    });
    await container.events.append(event);

    return reply.code(201).send(event);
  });

  app.get('/events', async (request) => {
    const query = parseRequest('query', listEventsQuery, request.query);
    return container.events.query(query);
  });
}
