import {
  createLifecycleEvent,
  ValidationError,
  type Account,
  type LifecycleEvent,
  type Persona,
} from '@persona/core';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryAccountRepository,
  InMemoryLifecycleEventStore,
  InMemoryPersonaRepository,
} from '../src/index.js';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc_1',
    platform: 'telegram',
    status: 'connected',
    personaId: null,
    deviceProfileId: null,
    proxyBindingId: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    connectedAt: '2026-07-01T12:00:00.000Z',
    statusChangedAt: '2026-07-01T12:00:00.000Z',
    metadata: { nested: { value: 1 } },
    ...overrides,
  };
}

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona_1',
    timezone: 'UTC',
    locale: 'en',
    niche: 'cooking',
    tone: 'friendly',
    topics: ['recipes'],
    audience: 'home cooks',
    activityWindow: { startHour: 9, endHour: 21, weekendActive: true },
    ...overrides,
  };
}

function makeEvent(
  type: LifecycleEvent['type'],
  createdAt: string,
  accountId = 'acc_1',
): LifecycleEvent {
  return createLifecycleEvent({ accountId, type, createdAt: new Date(createdAt) });
}

describe('InMemoryAccountRepository', () => {
  let repository: InMemoryAccountRepository;

  beforeEach(() => {
    repository = new InMemoryAccountRepository();
  });

  it('saves and loads an account', async () => {
    const saved = await repository.save(makeAccount());

    expect(saved).toEqual(makeAccount());
    expect(await repository.getById('acc_1')).toEqual(makeAccount());
    expect(await repository.getById('missing')).toBeNull();
  });

  it('replaces an account saved again under the same id', async () => {
    await repository.save(makeAccount());
    await repository.save(makeAccount({ status: 'onboarding' }));

    expect((await repository.getById('acc_1'))?.status).toBe('onboarding');
    expect(await repository.list()).toHaveLength(1);
  });

  it('never shares objects with its callers', async () => {
    const original = makeAccount();
    const saved = await repository.save(original);

    original.metadata = { changed: true };
    saved.status = 'dead';
    const loaded = await repository.getById('acc_1');
    if (loaded === null) {
      throw new Error('account should exist');
    }
    (loaded.metadata.nested as { value: number }).value = 99;
    const [listed] = await repository.list();
    if (listed === undefined) {
      throw new Error('account should be listed');
    }
    listed.status = 'dead';

    expect(await repository.getById('acc_1')).toEqual(makeAccount());
  });

  it('lists accounts by creation time and filters them by status', async () => {
    await repository.save(makeAccount({ id: 'b', createdAt: '2026-07-02T00:00:00.000Z' }));
    await repository.save(
      makeAccount({ id: 'a', createdAt: '2026-07-01T00:00:00.000Z', status: 'active' }),
    );
    await repository.save(makeAccount({ id: 'c', createdAt: '2026-07-02T00:00:00.000Z' }));

    expect((await repository.list()).map((account) => account.id)).toEqual(['a', 'b', 'c']);
    expect((await repository.list({ status: 'connected' })).map((account) => account.id)).toEqual([
      'b',
      'c',
    ]);
    expect(await repository.list({ status: 'dead' })).toEqual([]);
  });

  it('rejects an account without an id', async () => {
    await expect(repository.save(makeAccount({ id: '' }))).rejects.toThrow(ValidationError);
  });
});

describe('InMemoryPersonaRepository', () => {
  let repository: InMemoryPersonaRepository;

  beforeEach(() => {
    repository = new InMemoryPersonaRepository();
  });

  it('saves, loads and lists personas in the order they were first saved', async () => {
    await repository.save(makePersona({ id: 'b' }));
    await repository.save(makePersona({ id: 'a' }));
    await repository.save(makePersona({ id: 'b', niche: 'travel' }));

    expect((await repository.list()).map((persona) => persona.id)).toEqual(['b', 'a']);
    expect((await repository.getById('b'))?.niche).toBe('travel');
    expect(await repository.getById('missing')).toBeNull();
  });

  it('never shares objects with its callers', async () => {
    const original = makePersona();
    await repository.save(original);

    original.topics.push('travel');
    const loaded = await repository.getById('persona_1');
    if (loaded === null) {
      throw new Error('persona should exist');
    }
    loaded.topics.push('news');
    loaded.activityWindow.startHour = 0;

    expect(await repository.getById('persona_1')).toEqual(makePersona());
  });

  it('rejects a persona without an id', async () => {
    await expect(repository.save(makePersona({ id: '' }))).rejects.toThrow(ValidationError);
  });
});

describe('InMemoryLifecycleEventStore', () => {
  let store: InMemoryLifecycleEventStore;

  beforeEach(() => {
    store = new InMemoryLifecycleEventStore();
  });

  it('appends events and finds them by account, sorted by createdAt', async () => {
    const late = makeEvent('error', '2026-07-03T00:00:00Z');
    const early = makeEvent('error', '2026-07-01T00:00:00Z');
    const other = makeEvent('error', '2026-07-02T00:00:00Z', 'acc_2');
    await store.append(late);
    await store.append(other);
    await store.append(early);

    expect(await store.findByAccountId('acc_1')).toEqual([early, late]);
    expect(await store.findByAccountId('acc_2')).toEqual([other]);
    expect(await store.findByAccountId('missing')).toEqual([]);
  });

  it('keeps the order of appending for events with the same createdAt', async () => {
    const events = ['session_started', 'action_performed', 'session_ended'].map((type) =>
      makeEvent(type as LifecycleEvent['type'], '2026-07-01T00:00:00Z'),
    );
    for (const event of events) {
      await store.append(event);
    }

    expect(await store.query({})).toEqual(events);
  });

  it('filters by every given field', async () => {
    const events = [
      makeEvent('error', '2026-06-30T23:59:59Z'),
      makeEvent('restriction_detected', '2026-07-01T00:00:00Z'),
      makeEvent('restriction_detected', '2026-07-02T12:00:00Z', 'acc_2'),
      makeEvent('restriction_detected', '2026-07-03T23:59:59Z'),
      makeEvent('error', '2026-07-04T00:00:00Z'),
    ];
    for (const event of events) {
      await store.append(event);
    }

    expect(await store.query({ accountId: 'acc_2' })).toEqual([events[2]]);
    expect(await store.query({ type: 'error' })).toEqual([events[0], events[4]]);
    expect(await store.query({ startDate: '2026-07-01', endDate: '2026-07-03' })).toEqual([
      events[1],
      events[2],
      events[3],
    ]);
    expect(
      await store.query({
        accountId: 'acc_1',
        type: 'restriction_detected',
        startDate: '2026-07-02',
      }),
    ).toEqual([events[3]]);
  });

  it.each(['2026-02-30', '01.07.2026', 'x', ''])('rejects the invalid date %j', async (date) => {
    await expect(store.query({ startDate: date })).rejects.toThrow(ValidationError);
    await expect(store.query({ endDate: date })).rejects.toThrow(ValidationError);
  });

  it('never shares objects with its callers', async () => {
    const event = createLifecycleEvent({
      accountId: 'acc_1',
      type: 'error',
      payload: { nested: { value: 1 } },
    });
    const snapshot = structuredClone(event);
    await store.append(event);

    (event.payload.nested as { value: number }).value = 99;
    const [loaded] = await store.query({});
    if (loaded === undefined) {
      throw new Error('event should exist');
    }
    (loaded.payload.nested as { value: number }).value = 42;

    expect(await store.query({})).toEqual([snapshot]);
  });

  it('rejects an event without an id', async () => {
    await expect(
      store.append({ ...makeEvent('error', '2026-07-01T00:00:00Z'), id: '' }),
    ).rejects.toThrow(ValidationError);
  });
});
