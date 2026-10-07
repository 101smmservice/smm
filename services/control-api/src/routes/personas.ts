import { randomUUID } from 'node:crypto';

import type { Persona } from '@persona/core';
import type { FastifyInstance } from 'fastify';

import type { ControlApiContainer } from '../container.js';
import { requirePersona } from '../lookups.js';
import { parseRequest } from '../schemas/common.js';
import { createPersonaBody, personaParams, updatePersonaBody } from '../schemas/personas.js';

export function registerPersonaRoutes(app: FastifyInstance, container: ControlApiContainer): void {
  app.post('/personas', async (request, reply) => {
    const body = parseRequest('body', createPersonaBody, request.body);
    const persona: Persona = { id: randomUUID(), ...body };

    return reply.code(201).send(await container.personas.save(persona));
  });

  app.get('/personas', async () => container.personas.list());

  app.get('/personas/:personaId', async (request) => {
    const { personaId } = parseRequest('params', personaParams, request.params);
    return requirePersona(container, personaId);
  });

  app.patch('/personas/:personaId', async (request) => {
    const { personaId } = parseRequest('params', personaParams, request.params);
    const changes = parseRequest('body', updatePersonaBody, request.body);
    const { id, ...current } = await requirePersona(container, personaId);

    // Only the given fields change, but the persona as a whole has to stay valid.
    const merged = parseRequest('body', createPersonaBody, { ...current, ...changes });
    return container.personas.save({ id, ...merged });
  });
}
