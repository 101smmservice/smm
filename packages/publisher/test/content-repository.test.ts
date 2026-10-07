import { ValidationError } from '@persona/core';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createContentItemDraft,
  InMemoryContentRepository,
  type ContentItem,
} from '../src/index.js';

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    ...createContentItemDraft({
      id: 'item_1',
      accountId: 'acc_1',
      format: 'post',
      mediaRefs: ['media/1.png'],
      topics: ['cooking'],
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      metadata: { nested: { value: 1 } },
    }),
    ...overrides,
  };
}

describe('InMemoryContentRepository', () => {
  let repository: InMemoryContentRepository;

  beforeEach(() => {
    repository = new InMemoryContentRepository();
  });

  it('saves an item and returns it', async () => {
    const item = makeItem();

    const saved = await repository.save(item);

    expect(saved).toEqual(item);
  });

  it('returns a saved item by id', async () => {
    await repository.save(makeItem({ id: 'item_7', title: 'Seven' }));

    expect(await repository.getById('item_7')).toMatchObject({ id: 'item_7', title: 'Seven' });
  });

  it('returns null for an unknown id', async () => {
    expect(await repository.getById('missing')).toBeNull();
  });

  it('replaces an item that is saved again under the same id', async () => {
    await repository.save(makeItem({ title: 'First' }));
    await repository.save(makeItem({ title: 'Second' }));

    expect((await repository.getById('item_1'))?.title).toBe('Second');
    expect(await repository.findByAccountId('acc_1')).toHaveLength(1);
  });

  it('rejects an item without an id', async () => {
    await expect(repository.save(makeItem({ id: '' }))).rejects.toThrow(ValidationError);
  });

  describe('findByAccountId', () => {
    it('returns only the items of the account', async () => {
      await repository.save(makeItem({ id: 'a', accountId: 'acc_1' }));
      await repository.save(makeItem({ id: 'b', accountId: 'acc_2' }));
      await repository.save(makeItem({ id: 'c', accountId: 'acc_1' }));

      const items = await repository.findByAccountId('acc_1');

      expect(items.map((item) => item.id)).toEqual(['a', 'c']);
    });

    it('returns an empty array for an account without items', async () => {
      expect(await repository.findByAccountId('nobody')).toEqual([]);
    });

    it('orders items by createdAt, then by id', async () => {
      await repository.save(makeItem({ id: 'z', createdAt: '2026-07-01T08:00:00.000Z' }));
      await repository.save(makeItem({ id: 'b', createdAt: '2026-07-02T08:00:00.000Z' }));
      await repository.save(makeItem({ id: 'a', createdAt: '2026-07-02T08:00:00.000Z' }));
      await repository.save(makeItem({ id: 'y', createdAt: '2026-06-30T08:00:00.000Z' }));

      const items = await repository.findByAccountId('acc_1');

      expect(items.map((item) => item.id)).toEqual(['y', 'z', 'a', 'b']);
    });
  });

  describe('findByAccountAndPlannedDate', () => {
    it('returns only the items of the account planned for the date', async () => {
      await repository.save(makeItem({ id: 'a', plannedDate: '2026-07-10' }));
      await repository.save(makeItem({ id: 'b', plannedDate: '2026-07-11' }));
      await repository.save(makeItem({ id: 'c', plannedDate: null }));
      await repository.save(makeItem({ id: 'd', accountId: 'acc_2', plannedDate: '2026-07-10' }));
      await repository.save(makeItem({ id: 'e', plannedDate: '2026-07-10' }));

      const items = await repository.findByAccountAndPlannedDate('acc_1', '2026-07-10');

      expect(items.map((item) => item.id)).toEqual(['a', 'e']);
    });

    it('returns an empty array when nothing is planned for the date', async () => {
      await repository.save(makeItem({ plannedDate: '2026-07-10' }));

      expect(await repository.findByAccountAndPlannedDate('acc_1', '2026-08-01')).toEqual([]);
    });

    it.each(['2026-7-10', '10.07.2026', '2026-02-30', '', 'today'])(
      'rejects the invalid date %j',
      async (date) => {
        await expect(repository.findByAccountAndPlannedDate('acc_1', date)).rejects.toThrow(
          ValidationError,
        );
      },
    );
  });

  describe('isolation from callers', () => {
    it('stores a copy of the saved item', async () => {
      const item = makeItem();
      await repository.save(item);

      item.title = 'changed';
      item.mediaRefs.push('media/2.png');
      item.topics.push('travel');

      const stored = await repository.getById('item_1');
      expect(stored?.title).toBeNull();
      expect(stored?.mediaRefs).toEqual(['media/1.png']);
      expect(stored?.topics).toEqual(['cooking']);
    });

    it('returns copies from save', async () => {
      const item = makeItem();
      const saved = await repository.save(item);

      saved.title = 'changed';
      saved.mediaRefs.push('media/2.png');

      expect((await repository.getById('item_1'))?.title).toBeNull();
      expect(saved).not.toBe(item);
    });

    it('returns copies from getById', async () => {
      await repository.save(makeItem());

      const first = await repository.getById('item_1');
      if (first === null) {
        throw new Error('item should exist');
      }
      first.title = 'changed';
      first.mediaRefs.push('media/2.png');
      (first.metadata.nested as { value: number }).value = 99;

      const second = await repository.getById('item_1');
      expect(second).not.toBe(first);
      expect(second?.title).toBeNull();
      expect(second?.mediaRefs).toEqual(['media/1.png']);
      expect(second?.metadata).toEqual({ nested: { value: 1 } });
    });

    it('returns copies from the find methods', async () => {
      await repository.save(makeItem({ plannedDate: '2026-07-10' }));

      const [byAccount] = await repository.findByAccountId('acc_1');
      const [byDate] = await repository.findByAccountAndPlannedDate('acc_1', '2026-07-10');
      if (byAccount === undefined || byDate === undefined) {
        throw new Error('items should exist');
      }
      byAccount.title = 'changed';
      byDate.topics.push('travel');

      expect(byAccount).not.toBe(byDate);
      const stored = await repository.getById('item_1');
      expect(stored?.title).toBeNull();
      expect(stored?.topics).toEqual(['cooking']);
    });
  });

  it('removes everything on clear', async () => {
    await repository.save(makeItem({ id: 'a' }));
    await repository.save(makeItem({ id: 'b', plannedDate: '2026-07-10' }));

    repository.clear();

    expect(await repository.getById('a')).toBeNull();
    expect(await repository.findByAccountId('acc_1')).toEqual([]);
    expect(await repository.findByAccountAndPlannedDate('acc_1', '2026-07-10')).toEqual([]);
  });
});
