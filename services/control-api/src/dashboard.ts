import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export const DASHBOARD_PATH = '/dashboard/';

/**
 * The `public` directory at the root of the service. This module lives in `src/` when the service
 * runs through `tsx` and in `dist/` when it runs as `node dist/server.js`; both are one level below
 * the service root, so the same relative path finds the directory in either case.
 */
export const DASHBOARD_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url));

/** The page loads nothing from outside its own origin, and nothing may embed it. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Serves the local web dashboard under `/dashboard/` and sends `/` and `/dashboard` there.
 *
 * The dashboard is for local development: it has no authentication, so the service must not be
 * exposed beyond the machine it runs on (it listens on 127.0.0.1 unless `HOST` says otherwise).
 */
export async function registerDashboard(app: FastifyInstance): Promise<void> {
  app.get('/', (_request, reply) => reply.redirect(DASHBOARD_PATH));
  app.get('/dashboard', (_request, reply) => reply.redirect(DASHBOARD_PATH));

  await app.register(fastifyStatic, {
    root: DASHBOARD_DIRECTORY,
    prefix: DASHBOARD_PATH,
    index: 'index.html',
    dotfiles: 'deny',
    setHeaders: (reply) => {
      void reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
      void reply.header('X-Content-Type-Options', 'nosniff');
    },
  });
}
