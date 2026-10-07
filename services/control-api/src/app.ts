import type { ActivityPolicy } from '@persona/core';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadPolicies } from './config.js';
import { createContainer } from './container.js';
import { mapError } from './errors.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerContentRoutes } from './routes/content.js';
import { registerEventRoutes } from './routes/events.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPersonaRoutes } from './routes/personas.js';

export interface ControlApiOptions {
  /** Activity policies by key. When omitted they are read from `configPath`. */
  policies?: Record<string, ActivityPolicy>;
  /** Path of the policies YAML file. Defaults to `config/policies.yaml` of the repository. */
  configPath?: string;
  clock?: { now(): Date };
  rng?: () => number;
  /** Turns request logging on. Off by default. */
  logger?: boolean;
}

/**
 * Builds the control service as a Fastify instance without starting to listen, so it can be driven
 * with `app.inject(...)`. All data lives in memory and nothing in here reaches the network.
 */
export async function buildApp(options: ControlApiOptions = {}): Promise<FastifyInstance> {
  const container = createContainer({
    policies: await loadPolicies(options),
    clock: options.clock,
    rng: options.rng,
  });

  const app = Fastify({ logger: options.logger === true });

  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = mapError(error);
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
    }
    return reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'not_found',
        message: `Route ${request.method} ${request.url} not found`,
        details: [],
      },
    }),
  );

  registerHealthRoutes(app, container);
  registerAccountRoutes(app, container);
  registerPersonaRoutes(app, container);
  registerContentRoutes(app, container);
  registerEventRoutes(app, container);
  registerAnalyticsRoutes(app, container);

  return app;
}
