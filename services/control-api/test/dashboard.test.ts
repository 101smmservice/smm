import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Script } from 'node:vm';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DASHBOARD_DIRECTORY } from '../src/dashboard.js';
import { buildTestApp, createAccount, type ErrorBody } from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildTestApp());
});

afterEach(async () => {
  await app.close();
});

function get(url: string) {
  return app.inject({ method: 'GET', url });
}

/** Neutral wording only: the project rules ban these formulations, matched here by word stems. */
const BANNED_WORDING = [
  /ферм\S*\s+аккаунт/,
  /обход\S*\s+детекци/,
  /имитаци\S*\s+поведени/,
  /фейков\S*\s+люд/,
];

describe('redirects to the dashboard', () => {
  it('sends GET / to /dashboard/', async () => {
    const response = await get('/');

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/dashboard/');
  });

  it('sends GET /dashboard to /dashboard/', async () => {
    const response = await get('/dashboard');

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/dashboard/');
  });
});

describe('static files', () => {
  it('serves the page at /dashboard/', async () => {
    const response = await get('/dashboard/');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<div id="app">');
  });

  it('serves the same page at /dashboard/index.html', async () => {
    const [index, explicit] = await Promise.all([get('/dashboard/'), get('/dashboard/index.html')]);

    expect(explicit.statusCode).toBe(200);
    expect(explicit.body).toBe(index.body);
  });

  it('serves the stylesheet', async () => {
    const response = await get('/dashboard/styles.css');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/css');
  });

  it('serves the script', async () => {
    const response = await get('/dashboard/app.js');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('serves the script that the page references', async () => {
    const page = (await get('/dashboard/')).body;

    expect(page).toContain('src="app.js"');
    expect(page).toContain('href="styles.css"');
  });

  it('serves a script that is valid JavaScript', async () => {
    const source = (await get('/dashboard/app.js')).body;

    expect(() => new Script(source, { filename: 'app.js' })).not.toThrow();
  });

  it('serves the files from the public directory of the service', async () => {
    const onDisk = await readFile(join(DASHBOARD_DIRECTORY, 'app.js'), 'utf8');

    expect((await get('/dashboard/app.js')).body).toBe(onDisk);
  });

  it('answers 404 for a file that does not exist, in the common error format', async () => {
    const response = await get('/dashboard/nope.js');

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('not_found');
  });

  it.each(['/dashboard/%2e%2e/package.json', '/dashboard/../package.json', '/dashboard/.env'])(
    'does not serve %s',
    async (url) => {
      const response = await get(url);

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('@persona/control-api');
    },
  );
});

describe('page content', () => {
  it('has the six tabs, in Russian', async () => {
    const page = (await get('/dashboard/')).body;

    for (const label of ['Обзор', 'Аккаунты', 'Приём', 'Персоны', 'Контент', 'Аналитика']) {
      expect(page).toContain(label);
    }
    for (const route of ['overview', 'accounts', 'intake', 'personas', 'content', 'analytics']) {
      expect(page).toContain(`data-route="${route}"`);
    }
  });

  it('links the intake tab to #/intake', async () => {
    const page = (await get('/dashboard/')).body;

    expect(page).toContain('href="#/intake"');
  });

  it('has a script that talks to the intake endpoints and draws the charts', async () => {
    const script = (await get('/dashboard/app.js')).body;

    for (const marker of [
      '/intake/requests',
      '/submit',
      '/approve',
      '/reject',
      '/reopen',
      '/complete',
      'createElementNS',
      'restrictionFrequency',
      'actionFailureMetrics',
      'cohortSurvival',
    ]) {
      expect(script, marker).toContain(marker);
    }
  });

  it('has the simulator panel and talks to the simulator endpoints', async () => {
    const script = (await get('/dashboard/app.js')).body;

    for (const marker of [
      'Симуляция активности',
      'Запустить',
      'Остановить',
      '/simulator/status',
      '/simulator/start',
      '/simulator/stop',
    ]) {
      expect(script, marker).toContain(marker);
    }
  });

  it('shows what the simulator published and marks it as a simulation', async () => {
    const [script, styles] = await Promise.all([
      get('/dashboard/app.js'),
      get('/dashboard/styles.css'),
    ]);

    for (const marker of [
      'sim-post-',
      'simulated_publication_error',
      'simulatedTag',
      'publishedAt',
      'externalId',
      'failureReason',
      'Публикации контента',
      'publicationMetrics',
      'publicationsAttempted',
    ]) {
      expect(script.body, marker).toContain(marker);
    }
    expect(styles.body).toContain('.sim-tag');
  });

  it('refreshes the data by itself while the simulator runs, and by a button', async () => {
    const script = (await get('/dashboard/app.js')).body;

    expect(script).toContain('AUTO_REFRESH_MS = 5000');
    expect(script).toContain('Обновить');
    expect(script).toContain('currentRefresh');
  });

  it('styles the state of the simulator', async () => {
    const styles = (await get('/dashboard/styles.css')).body;

    for (const marker of [
      '.sim-indicator.running',
      '.sim-indicator.stopped',
      '.sim-indicator.error',
    ]) {
      expect(styles, marker).toContain(marker);
    }
  });

  it('draws the charts without libraries or inline styles', async () => {
    const [script, page] = await Promise.all([get('/dashboard/app.js'), get('/dashboard/')]);

    expect(script.body).not.toMatch(
      /\bimport\s*\(|\brequire\s*\(|<script|innerHTML|setAttribute\(\s*['"]style/,
    );
    expect(page.body).not.toMatch(/\sstyle=/);
  });

  it('sends headers that keep the page on its own origin', async () => {
    for (const url of ['/dashboard/', '/dashboard/app.js', '/dashboard/styles.css']) {
      const { headers } = await get(url);

      expect(headers['content-security-policy'], url).toContain("default-src 'self'");
      expect(headers['content-security-policy'], url).toContain("frame-ancestors 'none'");
      expect(headers['x-content-type-options'], url).toBe('nosniff');
    }
  });

  it.each(['/dashboard/', '/dashboard/styles.css', '/dashboard/app.js'])(
    'loads nothing from another origin in %s',
    async (url) => {
      // The SVG namespace is an identifier that the script passes to createElementNS, not an address
      // that anything is loaded from.
      const body = (await get(url)).body.replaceAll('http://www.w3.org/2000/svg', '');

      expect(body).not.toMatch(/https?:\/\//);
      expect(body).not.toMatch(/(?:src|href)=["']\/\//);
    },
  );

  it.each(['/dashboard/', '/dashboard/styles.css', '/dashboard/app.js'])(
    'does not use the banned wording in %s',
    async (url) => {
      const body = (await get(url)).body.toLowerCase();

      for (const pattern of BANNED_WORDING) {
        expect(body).not.toMatch(pattern);
      }
    },
  );
});

describe('the dashboard does not intercept the API', () => {
  it('still answers GET /accounts with JSON', async () => {
    await createAccount(app);

    const response = await get('/accounts');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json<unknown[]>()).toHaveLength(1);
  });

  it.each([
    '/health',
    '/api',
    '/personas',
    '/content',
    '/events',
    '/analytics/snapshot',
    '/simulator/status',
  ])('still answers GET %s with JSON', async (url) => {
    const response = await get(url);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('keeps the JSON 404 for an unknown account', async () => {
    const response = await get('/accounts/missing');

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json<ErrorBody>().error.code).toBe('not_found');
  });

  it('keeps the JSON 404 for an unknown route outside /dashboard/', async () => {
    const response = await get('/nope');

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('not_found');
  });

  it('keeps writes working next to the static files', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { platform: 'telegram' },
    });

    expect(response.statusCode).toBe(201);
  });
});
