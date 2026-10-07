import type { Persona } from '@persona/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  anyUuid,
  buildTestApp,
  createPersona,
  validPersonaBody,
  type ErrorBody,
} from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildTestApp());
});

afterEach(async () => {
  await app.close();
});

function post(payload: unknown) {
  return app.inject({ method: 'POST', url: '/personas', payload: payload as object });
}

function patch(personaId: string, payload: unknown) {
  return app.inject({ method: 'PATCH', url: `/personas/${personaId}`, payload: payload as object });
}

describe('POST /personas', () => {
  it('creates a persona', async () => {
    const response = await post(validPersonaBody);

    expect(response.statusCode).toBe(201);
    expect(response.json<Persona>()).toEqual({
      id: anyUuid(),
      ...validPersonaBody,
    });
  });

  it('generates a different id for every persona', async () => {
    const first = await createPersona(app);
    const second = await createPersona(app);

    expect(first.id).not.toBe(second.id);
  });

  it('trims texts and drops blank topics', async () => {
    const persona = await createPersona(app, {
      niche: '  cooking  ',
      topics: [' recipes ', '', '   ', 'travel'],
    });

    expect(persona.niche).toBe('cooking');
    expect(persona.topics).toEqual(['recipes', 'travel']);
  });

  it.each(['timezone', 'locale', 'niche', 'tone', 'audience'])(
    'answers 400 for an empty %s',
    async (field) => {
      for (const value of ['', '   ']) {
        const response = await post({ ...validPersonaBody, [field]: value });

        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>().error.code).toBe('validation_error');
        expect(JSON.stringify(response.json<ErrorBody>().error.details)).toContain(field);
      }
    },
  );

  it.each(['timezone', 'locale', 'niche', 'tone', 'topics', 'audience', 'activityWindow'])(
    'answers 400 when %s is missing',
    async (field) => {
      const rest = Object.fromEntries(
        Object.entries(validPersonaBody).filter(([key]) => key !== field),
      );

      expect((await post(rest)).statusCode).toBe(400);
    },
  );

  it.each([
    ['no topics', []],
    ['only blank topics', ['', '  ']],
  ])('answers 400 for %s', async (_label, topics) => {
    expect((await post({ ...validPersonaBody, topics })).statusCode).toBe(400);
  });

  it.each([
    ['startHour equal to endHour', { startHour: 9, endHour: 9 }],
    ['startHour greater than endHour', { startHour: 21, endHour: 9 }],
  ])('answers 400 for %s', async (_label, window) => {
    const response = await post({
      ...validPersonaBody,
      activityWindow: { ...window, weekendActive: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.details).toEqual([
      {
        path: ['body', 'activityWindow', 'startHour'],
        message: 'startHour must be less than endHour',
        code: 'custom',
      },
    ]);
  });

  it.each([
    ['an hour above 23', { startHour: 9, endHour: 24 }],
    ['a negative hour', { startHour: -1, endHour: 9 }],
    ['a fractional hour', { startHour: 9.5, endHour: 12 }],
    ['an hour that is not a number', { startHour: '9', endHour: 12 }],
  ])('answers 400 for %s', async (_label, window) => {
    const response = await post({
      ...validPersonaBody,
      activityWindow: { ...window, weekendActive: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it('accepts the widest window and a window of one hour', async () => {
    for (const window of [
      { startHour: 0, endHour: 23 },
      { startHour: 5, endHour: 6 },
    ]) {
      const response = await post({
        ...validPersonaBody,
        activityWindow: { ...window, weekendActive: false },
      });

      expect(response.statusCode).toBe(201);
    }
  });

  it.each([
    ['an unknown field', { ...validPersonaBody, mood: 'calm' }],
    [
      'an unknown field in the window',
      {
        ...validPersonaBody,
        activityWindow: { ...validPersonaBody.activityWindow, tz: 'UTC' },
      },
    ],
    ['a supplied id', { ...validPersonaBody, id: 'mine' }],
    [
      'a weekendActive that is not a boolean',
      {
        ...validPersonaBody,
        activityWindow: { ...validPersonaBody.activityWindow, weekendActive: 'yes' },
      },
    ],
  ])('answers 400 for %s', async (_label, payload) => {
    expect((await post(payload)).statusCode).toBe(400);
  });
});

describe('GET /personas', () => {
  it('returns an empty list at first', async () => {
    const response = await app.inject({ method: 'GET', url: '/personas' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('lists the personas in the order they were created', async () => {
    const first = await createPersona(app, { niche: 'cooking' });
    const second = await createPersona(app, { niche: 'travel' });

    const response = await app.inject({ method: 'GET', url: '/personas' });

    expect(response.json<Persona[]>()).toEqual([first, second]);
  });
});

describe('GET /personas/:personaId', () => {
  it('returns the persona', async () => {
    const persona = await createPersona(app);

    const response = await app.inject({ method: 'GET', url: `/personas/${persona.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(persona);
  });

  it('answers 404 for an unknown persona', async () => {
    const response = await app.inject({ method: 'GET', url: '/personas/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('not_found');
  });
});

describe('PATCH /personas/:personaId', () => {
  it('changes only the given fields', async () => {
    const persona = await createPersona(app);

    const response = await patch(persona.id, { niche: 'travel', tone: 'calm' });

    expect(response.statusCode).toBe(200);
    expect(response.json<Persona>()).toEqual({ ...persona, niche: 'travel', tone: 'calm' });
  });

  it('saves the change', async () => {
    const persona = await createPersona(app);
    await patch(persona.id, { audience: 'travellers' });

    const response = await app.inject({ method: 'GET', url: `/personas/${persona.id}` });

    expect(response.json<Persona>().audience).toBe('travellers');
  });

  it('replaces the activity window and the topics as a whole', async () => {
    const persona = await createPersona(app);

    const response = await patch(persona.id, {
      topics: [' news '],
      activityWindow: { startHour: 6, endHour: 12, weekendActive: false },
    });

    expect(response.json<Persona>()).toMatchObject({
      topics: ['news'],
      activityWindow: { startHour: 6, endHour: 12, weekendActive: false },
    });
  });

  it('leaves the persona as it is for an empty body', async () => {
    const persona = await createPersona(app);

    const response = await patch(persona.id, {});

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(persona);
  });

  it('keeps the id', async () => {
    const persona = await createPersona(app);

    expect((await patch(persona.id, { niche: 'x' })).json<Persona>().id).toBe(persona.id);
  });

  it.each([
    ['an empty text', { niche: '' }],
    ['a blank text', { tone: '   ' }],
    ['no topics', { topics: [] }],
    ['an inverted window', { activityWindow: { startHour: 20, endHour: 8, weekendActive: true } }],
    [
      'an hour out of range',
      { activityWindow: { startHour: 0, endHour: 24, weekendActive: true } },
    ],
    ['an incomplete window', { activityWindow: { startHour: 8 } }],
    ['an unknown field', { mood: 'calm' }],
    ['the id', { id: 'other' }],
    ['a value of the wrong type', { locale: 5 }],
  ])('answers 400 for %s and keeps the persona unchanged', async (_label, payload) => {
    const persona = await createPersona(app);

    const response = await patch(persona.id, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
    const stored = await app.inject({ method: 'GET', url: `/personas/${persona.id}` });
    expect(stored.json()).toEqual(persona);
  });

  it('answers 404 for an unknown persona', async () => {
    expect((await patch('missing', { niche: 'x' })).statusCode).toBe(404);
  });
});
