import { randomUUID } from 'node:crypto';

import { ValidationError } from '@persona/core';

import type { ContentFormat } from '../domain/content-format.js';
import {
  createContentItemDraft,
  isValidDateString,
  type ContentItem,
} from '../domain/content-item.js';
import { createEmptyStatusCounts, type ContentPlan } from '../domain/content-plan.js';
import type { ContentStatus } from '../domain/content-status.js';
import {
  ContentNotFoundError,
  ContentValidationError,
  InvalidContentTransitionError,
} from '../errors.js';
import { transitionContentItem } from '../state-machine/content-state-machine.js';
import { compareByCreation, type ContentRepository } from '../storage/content-repository.js';
import { validateContentTransition } from '../validation/content-readiness.js';

export interface PublisherClock {
  now(): Date;
}

export interface CreateContentDraftInput {
  accountId: string;
  personaId?: string | null;
  format: ContentFormat;
  title?: string | null;
  brief?: string | null;
  caption?: string | null;
  mediaRefs?: string[];
  topics?: string[];
  cta?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ContentTransitionInput {
  id: string;
  to: ContentStatus;
  /** The moment of the change. Defaults to the pipeline clock. */
  at?: Date;
  plannedDate?: string;
  scheduledAt?: string;
  externalId?: string;
  failureReason?: string;
}

export interface ContentPipelineOptions {
  clock?: PublisherClock;
}

export function createSystemClock(): PublisherClock {
  return { now: () => new Date() };
}

export function createFixedClock(now: Date): PublisherClock {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ValidationError('now must be a valid Date', 'now');
  }
  const fixed = now.getTime();
  return { now: () => new Date(fixed) };
}

/**
 * Editorial pipeline: prepares content items, moves them through their statuses and reports the
 * state of a day's plan.
 *
 * The pipeline only keeps records. It never publishes anything: `markPublished` records that a
 * scheduled item was published by someone or something else.
 */
export class ContentPipeline {
  private readonly repository: ContentRepository;
  private readonly clock: PublisherClock;

  constructor(repository: ContentRepository, options: ContentPipelineOptions = {}) {
    this.repository = repository;
    this.clock = options.clock ?? createSystemClock();
  }

  async createDraft(input: CreateContentDraftInput): Promise<ContentItem> {
    const item = createContentItemDraft({
      ...input,
      id: randomUUID(),
      createdAt: this.clock.now(),
    });
    return this.repository.save(item);
  }

  async getItem(id: string): Promise<ContentItem | null> {
    return this.repository.getById(id);
  }

  /**
   * Moves an item to a new status after checking that the move is allowed and that the item is
   * ready for it. Throws `ContentNotFoundError` for an unknown id and `ContentValidationError`
   * (`InvalidContentTransitionError` for a disallowed move) when the check fails.
   */
  async transition(input: ContentTransitionInput): Promise<ContentItem> {
    const item = await this.repository.getById(input.id);
    if (item === null) {
      throw new ContentNotFoundError(input.id);
    }

    const validation = validateContentTransition(item, input.to, {
      plannedDate: input.plannedDate,
      scheduledAt: input.scheduledAt,
      failureReason: input.failureReason,
    });
    if (!validation.valid) {
      if (validation.issues.some((issue) => issue.code === 'invalid_transition')) {
        throw new InvalidContentTransitionError(item.status, input.to);
      }
      throw new ContentValidationError(validation.issues);
    }

    const next = transitionContentItem(item, input.to, {
      at: input.at ?? this.clock.now(),
      plannedDate: input.plannedDate,
      scheduledAt: input.scheduledAt,
      externalId: input.externalId,
      failureReason: input.failureReason,
    });
    return this.repository.save(next);
  }

  /** Summarises the items an account has planned for `date` (`YYYY-MM-DD`). */
  async planForDate(accountId: string, date: string): Promise<ContentPlan> {
    if (!isValidDateString(date)) {
      throw new ValidationError('date must be a real date in YYYY-MM-DD format', 'date');
    }
    if (typeof accountId !== 'string' || accountId.trim() === '') {
      throw new ValidationError('accountId must be a non-empty string', 'accountId');
    }

    const items = (await this.repository.findByAccountAndPlannedDate(accountId, date)).sort(
      compareByCreation,
    );
    const counts = createEmptyStatusCounts();
    for (const item of items) {
      counts[item.status] += 1;
    }

    return {
      accountId,
      date,
      itemIds: items.map((item) => item.id),
      counts,
      isReady:
        items.length > 0 &&
        (counts.ready > 0 || counts.scheduled > 0 || counts.published > 0) &&
        counts.failed === 0,
    };
  }

  /** Records that a scheduled item was published. Only allowed from `scheduled`. */
  async markPublished(
    id: string,
    input: { at?: Date; externalId?: string } = {},
  ): Promise<ContentItem> {
    return this.transition({ id, to: 'published', at: input.at, externalId: input.externalId });
  }

  /** Records that a scheduled item failed to publish. Only allowed from `scheduled`. */
  async markFailed(id: string, reason: string, input: { at?: Date } = {}): Promise<ContentItem> {
    return this.transition({ id, to: 'failed', at: input.at, failureReason: reason });
  }
}
