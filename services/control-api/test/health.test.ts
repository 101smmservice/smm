import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ActivityPolicy } from '@persona/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveServerConfig } from '../src/config.js';
import { buildApp } from '../src/index.js';
import {
  buildTestApp,
  createAccount,
  moveAccount,
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

describe('GET /health', () => {
  it('reports that the service is up', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: '@persona/control-api',
      uptimeSeconds: 0,
    });
  });

  it('counts uptime with the injected clock', async () => {
    clock.advance(125_900);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.json<{ uptimeSeconds: number }>().uptimeSeconds).toBe(125);
  });
});

describe('GET /api', () => {
  interface Index {
    service: string;
    description: string;
    routes: { method: string; path: string; description: string }[];
  }

  it('describes the service and lists the main routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api' });
    const index = response.json<Index>();

    expect(response.statusCode).toBe(200);
    expect(index.service).toBe('@persona/control-api');
    expect(index.description.length).toBeGreaterThan(0);
    expect(index.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/health' }),
        expect.objectContaining({ method: 'POST', path: '/accounts' }),
        expect.objectContaining({ method: 'POST', path: '/accounts/:accountId/transition' }),
        expect.objectContaining({ method: 'POST', path: '/content/:contentId/published' }),
        expect.objectContaining({ method: 'GET', path: '/analytics/snapshot' }),
      ]),
    );
  });

  it('lists exactly the routes that are registered', async () => {
    const { routes } = (await app.inject({ method: 'GET', url: '/api' })).json<Index>();

    for (const route of routes) {
      expect(
        app.hasRoute({ method: route.method, url: route.path }),
        `${route.method} ${route.path}`,
      ).toBe(true);
    }
    expect(new Set(routes.map((route) => `${route.method} ${route.path}`)).size).toBe(
      routes.length,
    );
  });
});

describe('error responses', () => {
  it('use one format for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>()).toEqual({
      error: { code: 'not_found', message: 'Route GET /nope not found', details: [] },
    });
  });

  it('report a body that is not valid JSON as a validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/personas',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    expect(response.json<ErrorBody>().error.details).toEqual([]);
  });

  it('hide the cause of an unexpected error', async () => {
    const { app: failing } = await buildTestApp();
    failing.get('/boom', () => {
      throw new Error('database password is hunter2');
    });

    const response = await failing.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json<ErrorBody>()).toEqual({
      error: { code: 'internal_error', message: 'Internal server error', details: [] },
    });
    expect(response.body).not.toContain('hunter2');
    expect(response.body).not.toContain('stack');
    expect(response.body).not.toContain('.ts');
    await failing.close();
  });
});

describe('buildApp policies', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function policyOf(candidate: FastifyInstance): Promise<ActivityPolicy> {
    const account = await createAccount(candidate);
    await moveAccount(candidate, account.id, ['onboarding', 'warming', 'active']);
    const response = await candidate.inject({
      method: 'GET',
      url: `/accounts/${account.id}/policy`,
    });
    return response.json<ActivityPolicy>();
  }

  it('uses the given policies', async () => {
    const policy = await policyOf(app);

    expect(policy.stage).toBe('active');
    expect(policy.sessionsPerDay).toEqual([2, 4]);
  });

  it('starts with no policies when the file is missing', async () => {
    const candidate = await buildApp({
      configPath: join(tmpdir(), 'persona-missing-policies.yaml'),
    });

    expect((await policyOf(candidate)).stage).toBe('none');
    await candidate.close();
  });

  it('reads config/policies.yaml of the repository by default', async () => {
    const candidate = await buildApp({ clock });

    const policy = await policyOf(candidate);

    expect(policy.stage).toBe('active');
    expect(policy.maxSessionMinutes).toBe(30);
    await candidate.close();
  });

  it('reads the file given as configPath', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'persona-control-api-'));
    directories.push(directory);
    const path = join(directory, 'policies.yaml');
    await writeFile(
      path,
      [
        'active:',
        '  stage: custom',
        '  maxSessionMinutes: 7',
        '  sessionsPerDay: [1, 1]',
        '  actions:',
        ...['view', 'like', 'follow', 'post', 'comment'].flatMap((action) => [
          `    ${action}:`,
          '      maxPerDay: 1',
          '      probabilityPerEncounter: 0.5',
        ]),
        '  minIntervalMinutes: [1, 2]',
        '  skipDayProbability: 0',
        '',
      ].join('\n'),
      'utf8',
    );

    const candidate = await buildApp({ configPath: path });

    expect(await policyOf(candidate)).toMatchObject({ stage: 'custom', maxSessionMinutes: 7 });
    await candidate.close();
  });

  it('refuses to start with a policy file that exists but is invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'persona-control-api-'));
    directories.push(directory);
    const path = join(directory, 'policies.yaml');
    await writeFile(path, 'active:\n  stage: broken\n', 'utf8');

    await expect(buildApp({ configPath: path })).rejects.toThrow(/invalid policy/);
  });

  it('prefers given policies over the config file', async () => {
    const candidate = await buildApp({
      clock,
      policies: {},
      configPath: join(tmpdir(), 'persona-missing-policies.yaml'),
    });

    expect((await policyOf(candidate)).stage).toBe('none');
    await candidate.close();
  });
});

describe('resolveServerConfig', () => {
  it('defaults to 127.0.0.1:3000', () => {
    expect(resolveServerConfig({})).toEqual({ host: '127.0.0.1', port: 3000 });
    expect(resolveServerConfig({ HOST: '', PORT: '' })).toEqual({ host: '127.0.0.1', port: 3000 });
  });

  it('reads HOST and PORT', () => {
    expect(resolveServerConfig({ HOST: '0.0.0.0', PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it.each(['abc', '-1', '70000', '3000.5'])('rejects the PORT %j', (port) => {
    expect(() => resolveServerConfig({ PORT: port })).toThrow(/PORT/);
  });
});
