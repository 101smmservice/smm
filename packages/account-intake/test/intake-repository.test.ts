import type { Platform } from '@persona/core';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createIntakeRequestDraft,
  InMemoryIntakeRepository,
  IntakeValidationError,
  type IntakeRequest,
  type IntakeStatus,
} from '../src/index.js';

function makeRequest(overrides: Partial<IntakeRequest> = {}): IntakeRequest {
  return {
    ...createIntakeRequestDraft({
      id: 'req_1',
      platform: 'telegram',
      externalAccountId: 'ext_1',
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      metadata: { nested: { value: 1 } },
    }),
    ...overrides,
  };
}

function completed(overrides: Partial<IntakeRequest> = {}): IntakeRequest {
  return makeRequest({ status: 'completed', completedAccountId: 'acc_1', ...overrides });
}

describe('InMemoryIntakeRepository', () => {
  let repository: InMemoryIntakeRepository;

  beforeEach(() => {
    repository = new InMemoryIntakeRepository();
  });

  it('saves a request and returns it', async () => {
    const request = makeRequest();

    expect(await repository.save(request)).toEqual(request);
  });

  it('returns a saved request by id', async () => {
    await repository.save(makeRequest({ id: 'req_7', notes: 'seven' }));

    expect(await repository.getById('req_7')).toMatchObject({ id: 'req_7', notes: 'seven' });
  });

  it('returns null for an unknown request', async () => {
    expect(await repository.getById('missing')).toBeNull();
  });

  it('replaces a request that is saved again under the same id', async () => {
    await repository.save(makeRequest({ status: 'draft' }));
    await repository.save(makeRequest({ status: 'pending_review' }));

    expect((await repository.getById('req_1'))?.status).toBe('pending_review');
    expect(await repository.findByStatus('draft')).toEqual([]);
  });

  it('rejects a request without an id', async () => {
    await expect(repository.save(makeRequest({ id: '' }))).rejects.toThrow(IntakeValidationError);
  });

  describe('findByStatus', () => {
    it('returns only the requests in the status', async () => {
      await repository.save(makeRequest({ id: 'a', status: 'draft' }));
      await repository.save(makeRequest({ id: 'b', status: 'pending_review' }));
      await repository.save(makeRequest({ id: 'c', status: 'draft' }));

      const requests = await repository.findByStatus('draft');

      expect(requests.map((request) => request.id)).toEqual(['a', 'c']);
    });

    it('returns an empty array when no request has the status', async () => {
      await repository.save(makeRequest());

      expect(await repository.findByStatus('approved')).toEqual([]);
    });

    it('sorts by createdAt, then by id', async () => {
      await repository.save(makeRequest({ id: 'z', createdAt: '2026-07-01T08:00:00.000Z' }));
      await repository.save(makeRequest({ id: 'b', createdAt: '2026-07-02T08:00:00.000Z' }));
      await repository.save(makeRequest({ id: 'a', createdAt: '2026-07-02T08:00:00.000Z' }));
      await repository.save(makeRequest({ id: 'y', createdAt: '2026-06-30T08:00:00.000Z' }));

      const requests = await repository.findByStatus('draft');

      expect(requests.map((request) => request.id)).toEqual(['y', 'z', 'a', 'b']);
    });

    it('rejects an unknown status', async () => {
      await expect(repository.findByStatus('archived' as unknown as IntakeStatus)).rejects.toThrow(
        IntakeValidationError,
      );
    });
  });

  describe('findCompletedByPlatformAndExternalId', () => {
    it('returns the completed request of the external account', async () => {
      await repository.save(completed({ id: 'done' }));

      const found = await repository.findCompletedByPlatformAndExternalId('telegram', 'ext_1');

      expect(found?.id).toBe('done');
    });

    it('only considers requests in the completed status', async () => {
      for (const status of ['draft', 'pending_review', 'approved', 'rejected'] as const) {
        await repository.save(makeRequest({ id: status, status }));
      }

      expect(await repository.findCompletedByPlatformAndExternalId('telegram', 'ext_1')).toBeNull();
    });

    it('returns null when there is no completed request', async () => {
      expect(await repository.findCompletedByPlatformAndExternalId('telegram', 'ext_1')).toBeNull();
    });

    it('matches the platform and the external id exactly', async () => {
      await repository.save(
        completed({ id: 'done', platform: 'telegram', externalAccountId: 'ext_1' }),
      );

      expect(await repository.findCompletedByPlatformAndExternalId('x', 'ext_1')).toBeNull();
      expect(await repository.findCompletedByPlatformAndExternalId('telegram', 'ext_2')).toBeNull();
      expect(await repository.findCompletedByPlatformAndExternalId('telegram', 'EXT_1')).toBeNull();
    });

    it('ignores completed requests without an external id', async () => {
      await repository.save(completed({ externalAccountId: null }));

      expect(await repository.findCompletedByPlatformAndExternalId('telegram', 'ext_1')).toBeNull();
    });

    it.each(['', '   '])(
      'throws an IntakeValidationError for the empty externalAccountId %j',
      async (id) => {
        await expect(
          repository.findCompletedByPlatformAndExternalId('telegram', id),
        ).rejects.toThrow(IntakeValidationError);
      },
    );

    it('throws an IntakeValidationError for an unknown platform', async () => {
      await expect(
        repository.findCompletedByPlatformAndExternalId('facebook' as unknown as Platform, 'ext_1'),
      ).rejects.toThrow(IntakeValidationError);
    });
  });

  describe('isolation from callers', () => {
    it('stores a copy of the saved request', async () => {
      const request = makeRequest();
      await repository.save(request);

      request.notes = 'changed';
      request.metadata.added = true;

      const stored = await repository.getById('req_1');
      expect(stored?.notes).toBeNull();
      expect(stored?.metadata).toEqual({ nested: { value: 1 } });
    });

    it('returns copies from save', async () => {
      const request = makeRequest();
      const saved = await repository.save(request);

      saved.notes = 'changed';

      expect((await repository.getById('req_1'))?.notes).toBeNull();
      expect(saved).not.toBe(request);
    });

    it('returns copies from getById', async () => {
      await repository.save(makeRequest());

      const first = await repository.getById('req_1');
      if (first === null) {
        throw new Error('request should exist');
      }
      first.notes = 'changed';
      (first.metadata.nested as { value: number }).value = 99;

      const second = await repository.getById('req_1');
      expect(second).not.toBe(first);
      expect(second?.notes).toBeNull();
      expect(second?.metadata).toEqual({ nested: { value: 1 } });
    });

    it('returns copies of the lists and of what they contain', async () => {
      await repository.save(makeRequest({ id: 'a' }));
      await repository.save(completed({ id: 'b', externalAccountId: 'ext_b' }));

      const list = await repository.findByStatus('draft');
      const [first] = list;
      if (first === undefined) {
        throw new Error('request should exist');
      }
      first.notes = 'changed';
      list.pop();
      const found = await repository.findCompletedByPlatformAndExternalId('telegram', 'ext_b');
      if (found === null) {
        throw new Error('request should exist');
      }
      found.notes = 'changed';

      expect((await repository.findByStatus('draft'))[0]?.notes).toBeNull();
      expect((await repository.getById('b'))?.notes).toBeNull();
      expect(await repository.findByStatus('draft')).toHaveLength(1);
    });
  });

  it('removes everything on clear', async () => {
    await repository.save(makeRequest({ id: 'a' }));
    await repository.save(completed({ id: 'b' }));

    repository.clear();

    expect(await repository.getById('a')).toBeNull();
    expect(await repository.findByStatus('draft')).toEqual([]);
    expect(await repository.findCompletedByPlatformAndExternalId('telegram', 'ext_1')).toBeNull();
  });
});
