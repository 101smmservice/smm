import type { LifecycleEvent } from '@persona/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anyUuid, buildTestApp, createAccount, type ErrorBody } from './helpers.js';

let app: FastifyInstance;
let accountId: string;

beforeEach(async () => {
  ({ app } = await buildTestApp());
  accountId = (await createAccount(app)).id;
});

afterEach(async () => {
  await app.close();
});

async function addEvent(payload: Record<string, unknown>): Promise<LifecycleEvent> {
  const response = await app.inject({ method: 'POST', url: '/events', payload });
  if (response.statusCode !== 201) {
    throw new Error(`addEvent failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<LifecycleEvent>();
}

async function listEvents(query = ''): Promise<LifecycleEvent[]> {
  const response = await app.inject({ method: 'GET', url: `/events${query}` });
  return response.json<LifecycleEvent[]>();
}

describe('POST /events', () => {
  it('records an event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      payload: {
        accountId,
        type: 'restriction_detected',
        payload: { reason: 'rate' },
        createdAt: '2026-07-01T10:00:00Z',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<LifecycleEvent>()).toEqual({
      id: anyUuid(),
      accountId,
      type: 'restriction_detected',
      payload: { reason: 'rate' },
      createdAt: '2026-07-01T10:00:00.000Z',
    });
  });

  it('defaults the payload to an empty object and the time to the clock', async () => {
    const event = await addEvent({ accountId, type: 'session_started' });

    expect(event.payload).toEqual({});
    expect(event.createdAt).toBe('2026-07-01T12:00:00.000Z');
  });

  it('stores the event so that it can be listed', async () => {
    const event = await addEvent({ accountId, type: 'error' });

    expect(await listEvents()).toEqual([event]);
  });

  it('writes the time as UTC', async () => {
    const event = await addEvent({
      accountId,
      type: 'error',
      createdAt: '2026-07-01T23:30:00-05:00',
    });

    expect(event.createdAt).toBe('2026-07-02T04:30:00.000Z');
  });

  it('answers 404 for an unknown account', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { accountId: 'missing', type: 'error' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('not_found');
    expect(await listEvents()).toEqual([]);
  });

  it.each([
    ['an unknown type', { type: 'login' }],
    ['a missing type', {}],
    ['a payload that is not an object', { type: 'error', payload: [1] }],
    ['a createdAt that is not a timestamp', { type: 'error', createdAt: 'yesterday' }],
    ['a createdAt without an offset', { type: 'error', createdAt: '2026-07-01T10:00:00' }],
    ['an unknown field', { type: 'error', severity: 'high' }],
  ])('answers 400 for %s', async (_label, extra) => {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { accountId, ...extra },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_error');
  });
});

describe('GET /events', () => {
  async function seed(): Promise<{ other: string; events: LifecycleEvent[] }> {
    const other = (await createAccount(app)).id;
    const events = [
      await addEvent({ accountId, type: 'error', createdAt: '2026-06-30T23:59:59Z' }),
      await addEvent({
        accountId,
        type: 'restriction_detected',
        createdAt: '2026-07-01T00:00:00Z',
      }),
      await addEvent({
        accountId: other,
        type: 'restriction_detected',
        createdAt: '2026-07-02T10:00:00Z',
      }),
      await addEvent({ accountId, type: 'action_performed', createdAt: '2026-07-03T23:59:59Z' }),
      await addEvent({ accountId: other, type: 'error', createdAt: '2026-07-04T00:00:00Z' }),
    ];
    return { other, events };
  }

  it('returns every event without filters', async () => {
    const { events } = await seed();

    expect(await listEvents()).toEqual(events);
  });

  it('returns an empty list when there are no events', async () => {
    expect(await listEvents()).toEqual([]);
  });

  it('filters by accountId', async () => {
    const { other, events } = await seed();

    expect(await listEvents(`?accountId=${other}`)).toEqual([events[2], events[4]]);
    expect(await listEvents('?accountId=missing')).toEqual([]);
  });

  it('filters by type', async () => {
    const { events } = await seed();

    expect(await listEvents('?type=restriction_detected')).toEqual([events[1], events[2]]);
    expect(await listEvents('?type=session_ended')).toEqual([]);
  });

  it('filters by a date range that includes both ends', async () => {
    const { events } = await seed();

    expect(await listEvents('?startDate=2026-07-01&endDate=2026-07-03')).toEqual([
      events[1],
      events[2],
      events[3],
    ]);
  });

  it('accepts a range with only one end', async () => {
    const { events } = await seed();

    expect(await listEvents('?startDate=2026-07-03')).toEqual([events[3], events[4]]);
    expect(await listEvents('?endDate=2026-06-30')).toEqual([events[0]]);
  });

  it('accepts a range of a single day', async () => {
    const { events } = await seed();

    expect(await listEvents('?startDate=2026-07-02&endDate=2026-07-02')).toEqual([events[2]]);
  });

  it('combines every filter', async () => {
    const { other, events } = await seed();

    const result = await listEvents(
      `?accountId=${other}&type=restriction_detected&startDate=2026-07-01&endDate=2026-07-02`,
    );

    expect(result).toEqual([events[2]]);
  });

  it.each(['2026-02-30', '01.07.2026', '2026-7-1', 'yesterday'])(
    'answers 400 for the date %j',
    async (date) => {
      for (const field of ['startDate', 'endDate']) {
        const response = await app.inject({ method: 'GET', url: `/events?${field}=${date}` });

        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>().error.code).toBe('validation_error');
      }
    },
  );

  it('answers 400 when the range is reversed, the type is unknown or a parameter is unknown', async () => {
    for (const query of [
      '?startDate=2026-07-03&endDate=2026-07-01',
      '?type=login',
      '?severity=high',
    ]) {
      expect((await app.inject({ method: 'GET', url: `/events${query}` })).statusCode).toBe(400);
    }
  });

  it('sorts events by createdAt, whatever order they were recorded in', async () => {
    const late = await addEvent({ accountId, type: 'error', createdAt: '2026-07-05T00:00:00Z' });
    const early = await addEvent({ accountId, type: 'error', createdAt: '2026-07-01T00:00:00Z' });
    const middle = await addEvent({ accountId, type: 'error', createdAt: '2026-07-03T00:00:00Z' });

    expect(await listEvents()).toEqual([early, middle, late]);
  });

  it('keeps the order of recording for events with the same createdAt', async () => {
    const first = await addEvent({ accountId, type: 'session_started' });
    const second = await addEvent({ accountId, type: 'action_performed' });
    const third = await addEvent({ accountId, type: 'session_ended' });

    expect(await listEvents()).toEqual([first, second, third]);
  });

  it('sorts by the moment, not by how the timestamp is written', async () => {
    const later = await addEvent({ accountId, type: 'error', createdAt: '2026-07-01T12:00:00Z' });
    const earlier = await addEvent({
      accountId,
      type: 'error',
      createdAt: '2026-07-01T10:00:00-05:00',
    });

    // 10:00-05:00 is 15:00Z, so it comes after 12:00Z although its text sorts before it.
    expect(await listEvents()).toEqual([later, earlier]);
  });
});
