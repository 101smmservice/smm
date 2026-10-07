import { isPlatform, type Platform } from '@persona/core';

import type { IntakeRequest } from '../domain/intake-request.js';
import { isIntakeStatus, type IntakeStatus } from '../domain/intake-status.js';
import { IntakeValidationError } from '../errors.js';

export interface IntakeRepository {
  getById(id: string): Promise<IntakeRequest | null>;
  save(request: IntakeRequest): Promise<IntakeRequest>;
  findByStatus(status: IntakeStatus): Promise<IntakeRequest[]>;
  findCompletedByPlatformAndExternalId(
    platform: Platform,
    externalAccountId: string,
  ): Promise<IntakeRequest | null>;
}

/**
 * Keeps requests in memory only. Everything that goes in or comes out is a deep copy, so callers can
 * never change stored state by mutating an object they hold.
 */
export class InMemoryIntakeRepository implements IntakeRepository {
  private readonly requests = new Map<string, IntakeRequest>();

  async getById(id: string): Promise<IntakeRequest | null> {
    const request = this.requests.get(id);
    return request === undefined ? null : structuredClone(request);
  }

  async save(request: IntakeRequest): Promise<IntakeRequest> {
    if (typeof request.id !== 'string' || request.id === '') {
      throw new IntakeValidationError('id must be a non-empty string', 'id');
    }
    this.requests.set(request.id, structuredClone(request));
    return structuredClone(request);
  }

  /** Requests in the status, ordered by `createdAt`, then by `id`. */
  async findByStatus(status: IntakeStatus): Promise<IntakeRequest[]> {
    if (!isIntakeStatus(status)) {
      throw new IntakeValidationError(`unknown status: ${JSON.stringify(status)}`, 'status');
    }
    return this.select((request) => request.status === status);
  }

  /** Only requests in the `completed` status are considered. */
  async findCompletedByPlatformAndExternalId(
    platform: Platform,
    externalAccountId: string,
  ): Promise<IntakeRequest | null> {
    if (typeof externalAccountId !== 'string' || externalAccountId.trim() === '') {
      throw new IntakeValidationError(
        'externalAccountId must be a non-empty string',
        'externalAccountId',
      );
    }
    if (!isPlatform(platform)) {
      throw new IntakeValidationError(`unknown platform: ${JSON.stringify(platform)}`, 'platform');
    }

    const [match] = this.select(
      (request) =>
        request.status === 'completed' &&
        request.platform === platform &&
        request.externalAccountId === externalAccountId,
    );
    return match ?? null;
  }

  /** Removes every stored request. Meant for tests. */
  clear(): void {
    this.requests.clear();
  }

  private select(predicate: (request: IntakeRequest) => boolean): IntakeRequest[] {
    return [...this.requests.values()]
      .filter(predicate)
      .sort(compareByCreation)
      .map((request) => structuredClone(request));
  }
}

function compareByCreation(a: IntakeRequest, b: IntakeRequest): number {
  const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (byTime !== 0 && !Number.isNaN(byTime)) {
    return byTime;
  }
  if (a.id < b.id) {
    return -1;
  }
  return a.id > b.id ? 1 : 0;
}
