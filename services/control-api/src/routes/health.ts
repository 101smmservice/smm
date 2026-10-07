import type { FastifyInstance } from 'fastify';

import type { ControlApiContainer } from '../container.js';

export const SERVICE_NAME = '@persona/control-api';

export interface RouteDescription {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  description: string;
}

/** Every route the service exposes. `GET /` reports this list, and a test keeps it honest. */
export const ROUTES: readonly RouteDescription[] = [
  { method: 'GET', path: '/health', description: 'Liveness check' },
  { method: 'GET', path: '/', description: 'Service description and route list' },

  { method: 'POST', path: '/accounts', description: 'Create an account in the connected status' },
  { method: 'GET', path: '/accounts', description: 'List accounts, optionally by status' },
  { method: 'GET', path: '/accounts/:accountId', description: 'Get an account' },
  {
    method: 'POST',
    path: '/accounts/:accountId/transition',
    description: 'Move an account to another status',
  },
  { method: 'POST', path: '/accounts/:accountId/persona', description: 'Assign a persona' },
  {
    method: 'GET',
    path: '/accounts/:accountId/policy',
    description: 'Activity policy of the account',
  },
  { method: 'GET', path: '/accounts/:accountId/plan', description: 'Daily plan for ?date=' },
  {
    method: 'GET',
    path: '/accounts/:accountId/action-permission',
    description: 'Whether ?action= is allowed by the daily budget',
  },
  {
    method: 'GET',
    path: '/accounts/:accountId/content-plan',
    description: 'Content plan for ?date=',
  },

  { method: 'POST', path: '/personas', description: 'Create a persona' },
  { method: 'GET', path: '/personas', description: 'List personas' },
  { method: 'GET', path: '/personas/:personaId', description: 'Get a persona' },
  { method: 'PATCH', path: '/personas/:personaId', description: 'Update fields of a persona' },

  { method: 'POST', path: '/content', description: 'Create a content draft' },
  { method: 'GET', path: '/content/:contentId', description: 'Get a content item' },
  {
    method: 'POST',
    path: '/content/:contentId/transition',
    description: 'Move a content item to another status',
  },
  {
    method: 'POST',
    path: '/content/:contentId/published',
    description: 'Confirm that a scheduled item was published (needs confirm: true)',
  },
  {
    method: 'POST',
    path: '/content/:contentId/failed',
    description: 'Record that publishing a scheduled item failed',
  },

  { method: 'POST', path: '/intake/requests', description: 'Create an intake request (draft)' },
  {
    method: 'GET',
    path: '/intake/requests',
    description: 'List intake requests, optionally by status',
  },
  { method: 'GET', path: '/intake/requests/:requestId', description: 'Get an intake request' },
  {
    method: 'POST',
    path: '/intake/requests/:requestId/submit',
    description: 'Submit for review with a confirmation of ownership',
  },
  {
    method: 'POST',
    path: '/intake/requests/:requestId/approve',
    description: 'Approve after the reviewer confirmed ownership (needs confirmOwnership: true)',
  },
  {
    method: 'POST',
    path: '/intake/requests/:requestId/reject',
    description: 'Reject with a reason',
  },
  {
    method: 'POST',
    path: '/intake/requests/:requestId/reopen',
    description: 'Return a rejected request to draft',
  },
  {
    method: 'POST',
    path: '/intake/requests/:requestId/complete',
    description: 'Create the account record for an approved request',
  },

  { method: 'POST', path: '/events', description: 'Record a lifecycle event' },
  { method: 'GET', path: '/events', description: 'List events with filters' },

  {
    method: 'GET',
    path: '/analytics/snapshot',
    description: 'Analytics snapshot of the portfolio',
  },
];

export function registerHealthRoutes(app: FastifyInstance, container: ControlApiContainer): void {
  const startedAt = container.clock.now().getTime();

  app.get('/health', () => ({
    status: 'ok',
    service: SERVICE_NAME,
    uptimeSeconds: Math.max(0, Math.floor((container.clock.now().getTime() - startedAt) / 1000)),
  }));

  app.get('/', () => ({
    service: SERVICE_NAME,
    description:
      'Local control service for the account portfolio. It keeps its data in memory, performs no ' +
      'actions on any platform, and records content publications without carrying them out.',
    routes: ROUTES,
  }));
}
