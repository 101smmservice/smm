import { randomUUID } from 'node:crypto';

import {
  createLifecycleEvent,
  type Account,
  type AccountRepository,
  type LifecycleEventStore,
  type Platform,
  type PersonaRepository,
} from '@persona/core';

import {
  createIntakeRequestDraft,
  type IntakeRequest,
  type IntakeSource,
} from '../domain/intake-request.js';
import { DuplicateIntakeError, IntakeNotFoundError, IntakeValidationError } from '../errors.js';
import {
  assertIntakeTransition,
  requiresOwnershipConfirmation,
} from '../state-machine/intake-state-machine.js';
import type { IntakeRepository } from '../storage/intake-repository.js';

export interface IntakeClock {
  now(): Date;
}

export interface CreateIntakeDraftInput {
  platform: Platform;
  externalAccountId?: string | null;
  externalUsername?: string | null;
  source?: IntakeSource;
  desiredPersonaId?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SubmitIntakeInput {
  /** Must be `true`: the submitter confirms that they own the account. */
  ownershipConfirmed: boolean;
}

export interface ApproveIntakeInput {
  /** Must be `true`: the reviewer confirms that ownership of the account was verified. */
  confirmOwnership: boolean;
  /** Kept in the request metadata as `reviewerNote`. */
  reviewerNote?: string;
}

export interface RejectIntakeInput {
  reason: string;
}

export interface CompleteIntakeInput {
  /** Overrides the persona the request asked for. */
  personaId?: string;
}

export interface CompleteIntakeResult {
  request: IntakeRequest;
  account: Account;
}

export interface IntakeServiceOptions {
  repository: IntakeRepository;
  accounts: AccountRepository;
  /** When given, the persona chosen at completion is checked against it. */
  personas?: PersonaRepository;
  /** When given, completing a request records a `state_changed` event for the new account. */
  events?: LifecycleEventStore;
  clock?: IntakeClock;
}

export function createIntakeSystemClock(): IntakeClock {
  return { now: () => new Date() };
}

export function createIntakeFixedClock(now: Date): IntakeClock {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new IntakeValidationError('now must be a valid Date', 'now');
  }
  const fixed = now.getTime();
  return { now: () => new Date(fixed) };
}

/**
 * Manual intake of accounts: a request is drafted, submitted with a confirmation of ownership,
 * reviewed by a person, and only then turned into an account record.
 *
 * Nothing here creates an account on a platform or contacts one. Completing a request only adds a
 * record to the portfolio for an account that already exists and is owned by the submitter.
 *
 * Operations that change a request run one after another, so two calls can never complete the same
 * request, or two requests for the same external account, at the same time.
 */
export class IntakeService {
  private readonly repository: IntakeRepository;
  private readonly accounts: AccountRepository;
  private readonly personas: PersonaRepository | undefined;
  private readonly events: LifecycleEventStore | undefined;
  private readonly clock: IntakeClock;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: IntakeServiceOptions) {
    this.repository = options.repository;
    this.accounts = options.accounts;
    this.personas = options.personas;
    this.events = options.events;
    this.clock = options.clock ?? createIntakeSystemClock();
  }

  async createDraft(input: CreateIntakeDraftInput): Promise<IntakeRequest> {
    const request = createIntakeRequestDraft({
      ...input,
      id: randomUUID(),
      createdAt: this.clock.now(),
    });
    return this.repository.save(request);
  }

  async getRequest(id: string): Promise<IntakeRequest | null> {
    return this.repository.getById(id);
  }

  /** `draft -> pending_review`. The submitter has to confirm ownership of the account. */
  async submitForReview(id: string, input: SubmitIntakeInput): Promise<IntakeRequest> {
    return this.exclusive(async () => {
      const request = await this.load(id);
      assertIntakeTransition(request.status, 'pending_review');
      if (
        requiresOwnershipConfirmation(request.status, 'pending_review') &&
        !isTrue(input.ownershipConfirmed)
      ) {
        throw new IntakeValidationError(
          'ownership of the account must be confirmed before the request is submitted',
          'ownershipConfirmed',
        );
      }

      const now = this.nowIso();
      return this.repository.save({
        ...request,
        status: 'pending_review',
        ownershipConfirmed: true,
        submittedAt: now,
        updatedAt: now,
      });
    });
  }

  /** `pending_review -> approved`. The reviewer has to confirm that ownership was verified. */
  async approve(id: string, input: ApproveIntakeInput): Promise<IntakeRequest> {
    return this.exclusive(async () => {
      const request = await this.load(id);
      assertIntakeTransition(request.status, 'approved');
      if (!isTrue(input.confirmOwnership)) {
        throw new IntakeValidationError(
          'ownership of the account must be confirmed by the reviewer',
          'confirmOwnership',
        );
      }
      if (input.reviewerNote !== undefined && typeof input.reviewerNote !== 'string') {
        throw new IntakeValidationError('reviewerNote must be a string', 'reviewerNote');
      }

      const now = this.nowIso();
      return this.repository.save({
        ...request,
        status: 'approved',
        reviewedAt: now,
        updatedAt: now,
        metadata:
          input.reviewerNote === undefined
            ? request.metadata
            : { ...request.metadata, reviewerNote: input.reviewerNote },
      });
    });
  }

  /** `pending_review -> rejected` or `approved -> rejected`, with a reason. */
  async reject(id: string, input: RejectIntakeInput): Promise<IntakeRequest> {
    return this.exclusive(async () => {
      const request = await this.load(id);
      assertIntakeTransition(request.status, 'rejected');
      if (typeof input.reason !== 'string' || input.reason.trim() === '') {
        throw new IntakeValidationError('a reason is required to reject a request', 'reason');
      }

      const now = this.nowIso();
      return this.repository.save({
        ...request,
        status: 'rejected',
        rejectionReason: input.reason.trim(),
        reviewedAt: request.reviewedAt ?? now,
        updatedAt: now,
      });
    });
  }

  /** `rejected -> draft`: the rejection reason is cleared so the request can be corrected. */
  async reopen(id: string): Promise<IntakeRequest> {
    return this.exclusive(async () => {
      const request = await this.load(id);
      assertIntakeTransition(request.status, 'draft');

      return this.repository.save({
        ...request,
        status: 'draft',
        rejectionReason: null,
        updatedAt: this.nowIso(),
      });
    });
  }

  /**
   * `approved -> completed`: adds the account to the portfolio in the `connected` status and links
   * it to the request.
   *
   * The persona is `input.personaId`, else the one the request asked for. It is checked against the
   * persona repository when one was given. A second request for the same external account cannot be
   * completed.
   */
  async complete(id: string, input: CompleteIntakeInput = {}): Promise<CompleteIntakeResult> {
    return this.exclusive(async () => {
      const request = await this.load(id);
      assertIntakeTransition(request.status, 'completed');
      if (
        requiresOwnershipConfirmation(request.status, 'completed') &&
        !request.ownershipConfirmed
      ) {
        throw new IntakeValidationError(
          'ownership of the account was never confirmed',
          'ownershipConfirmed',
        );
      }

      const personaId = await this.choosePersona(request, input);
      await this.assertNotDuplicate(request);

      const now = this.clock.now();
      const nowIso = now.toISOString();
      const account: Account = {
        id: randomUUID(),
        platform: request.platform,
        status: 'connected',
        personaId,
        deviceProfileId: null,
        proxyBindingId: null,
        createdAt: nowIso,
        connectedAt: nowIso,
        statusChangedAt: nowIso,
        metadata: {
          intakeRequestId: request.id,
          intakeSource: request.source,
          externalAccountId: request.externalAccountId,
          externalUsername: request.externalUsername,
        },
      };
      const savedAccount = await this.accounts.save(account);

      if (this.events !== undefined) {
        await this.events.append(
          createLifecycleEvent({
            accountId: savedAccount.id,
            type: 'state_changed',
            payload: {
              from: null,
              to: 'connected',
              source: 'account-intake',
              intakeRequestId: request.id,
            },
            createdAt: now,
          }),
        );
      }

      const savedRequest = await this.repository.save({
        ...request,
        status: 'completed',
        completedAt: nowIso,
        completedAccountId: savedAccount.id,
        updatedAt: nowIso,
      });
      return { request: savedRequest, account: savedAccount };
    });
  }

  private async load(id: string): Promise<IntakeRequest> {
    const request = await this.repository.getById(id);
    if (request === null) {
      throw new IntakeNotFoundError(id);
    }
    return request;
  }

  private async choosePersona(
    request: IntakeRequest,
    input: CompleteIntakeInput,
  ): Promise<string | null> {
    if (
      input.personaId !== undefined &&
      (typeof input.personaId !== 'string' || input.personaId.trim() === '')
    ) {
      throw new IntakeValidationError('personaId must be a non-empty string', 'personaId');
    }

    const personaId = input.personaId ?? request.desiredPersonaId;
    if (personaId !== null && this.personas !== undefined) {
      if ((await this.personas.getById(personaId)) === null) {
        throw new IntakeValidationError(`persona not found: ${personaId}`, 'personaId');
      }
    }
    return personaId;
  }

  private async assertNotDuplicate(request: IntakeRequest): Promise<void> {
    if (request.externalAccountId === null) {
      return;
    }
    const existing = await this.repository.findCompletedByPlatformAndExternalId(
      request.platform,
      request.externalAccountId,
    );
    if (existing !== null && existing.id !== request.id) {
      throw new DuplicateIntakeError(request.platform, request.externalAccountId, existing.id);
    }
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  /** Runs `task` after every task that was started before it has finished. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** Strictly `true`: a caller that is not type-checked may pass `'yes'` or `1`, which do not count. */
function isTrue(value: unknown): boolean {
  return value === true;
}
