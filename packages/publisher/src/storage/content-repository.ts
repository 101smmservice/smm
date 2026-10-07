import { ValidationError } from '@persona/core';

import { isValidDateString, type ContentItem } from '../domain/content-item.js';

export interface ContentRepository {
  getById(id: string): Promise<ContentItem | null>;
  save(item: ContentItem): Promise<ContentItem>;
  findByAccountId(accountId: string): Promise<ContentItem[]>;
  findByAccountAndPlannedDate(accountId: string, date: string): Promise<ContentItem[]>;
}

/**
 * Keeps items in memory only. Everything that goes in or comes out is a deep copy, so callers can
 * never change stored state by mutating an object they hold. Lists are ordered by `createdAt`,
 * then by `id`.
 */
export class InMemoryContentRepository implements ContentRepository {
  private readonly items = new Map<string, ContentItem>();

  async getById(id: string): Promise<ContentItem | null> {
    const item = this.items.get(id);
    return item === undefined ? null : structuredClone(item);
  }

  async save(item: ContentItem): Promise<ContentItem> {
    if (typeof item.id !== 'string' || item.id === '') {
      throw new ValidationError('id must be a non-empty string', 'id');
    }
    this.items.set(item.id, structuredClone(item));
    return structuredClone(item);
  }

  async findByAccountId(accountId: string): Promise<ContentItem[]> {
    return this.select((item) => item.accountId === accountId);
  }

  async findByAccountAndPlannedDate(accountId: string, date: string): Promise<ContentItem[]> {
    if (!isValidDateString(date)) {
      throw new ValidationError('date must be a real date in YYYY-MM-DD format', 'date');
    }
    return this.select((item) => item.accountId === accountId && item.plannedDate === date);
  }

  /** Removes every stored item. Meant for tests. */
  clear(): void {
    this.items.clear();
  }

  private select(predicate: (item: ContentItem) => boolean): ContentItem[] {
    return [...this.items.values()]
      .filter(predicate)
      .sort(compareByCreation)
      .map((item) => structuredClone(item));
  }
}

export function compareByCreation(a: ContentItem, b: ContentItem): number {
  const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (byTime !== 0 && !Number.isNaN(byTime)) {
    return byTime;
  }
  if (a.id < b.id) {
    return -1;
  }
  return a.id > b.id ? 1 : 0;
}
