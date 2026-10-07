import type { FastifyInstance } from 'fastify';

import type { ControlApiContainer } from '../container.js';
import { parseRequest } from '../schemas/common.js';
import { startSimulatorBody, stopSimulatorBody } from '../schemas/simulator.js';

/**
 * Controls of the activity simulator. The simulation is local: it generates events in memory and has
 * nothing to do with any real platform.
 */
export function registerSimulatorRoutes(
  app: FastifyInstance,
  container: ControlApiContainer,
): void {
  const { simulator } = container;

  app.get('/simulator/status', () => simulator.getStatus());

  app.post('/simulator/start', async (request) => {
    const body = parseRequest('body', startSimulatorBody, request.body ?? {});

    await simulator.start({
      ...(body.speed === undefined ? {} : { speed: body.speed }),
      ...(body.tickIntervalMs === undefined ? {} : { tickIntervalMs: body.tickIntervalMs }),
      ...(body.maxTicks === undefined ? {} : { maxTicks: body.maxTicks }),
    });
    return simulator.getStatus();
  });

  app.post('/simulator/stop', async (request) => {
    parseRequest('body', stopSimulatorBody, request.body ?? {});

    await simulator.stop();
    return simulator.getStatus();
  });
}
