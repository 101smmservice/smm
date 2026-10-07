import {
  DomainError,
  type Account,
  type AccountRepository,
  type LifecycleEvent,
  type LifecycleEventStore,
  type Persona,
  type PersonaRepository,
  type Platform,
} from '@persona/core';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createIntakeFixedClock,
  createIntakeSystemClock,
  DuplicateIntakeError,
  InMemoryIntakeRepository,
  IntakeError,
  IntakeNotFoundError,
  IntakeService,
  IntakeValidationError,
  InvalidIntakeTransitionError,
  type CreateIntakeDraftInput,
  type IntakeRequest,
} from '../src/index.js';

const NOW = new Date('2026-07-01T12:00:00.000Z');
const NOW_ISO = '2026-07-01T12:00:00.000Z';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class FakeAccountRepository implements AccountRepository {
  readonly items = new Map<string, Account>();

  getById(id: string): Promise<Account | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  save(account: Account): Promise<Account> {
    this.items.set(account.id, structuredClone(account));
    return Promise.resolve(structuredClone(account));
  }
}

class FakePersonaRepository implements PersonaRepository {
  readonly items = new Map<string, Persona>();

  getById(id: string): Promise<Persona | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  save(persona: Persona): Promise<Persona> {
    this.items.set(persona.id, persona);
    return Promise.resolve(persona);
  }
}

class FakeEventStore implements LifecycleEventStore {
  readonly events: LifecycleEvent[] = [];

  append(event: LifecycleEvent): Promise<void> {
    this.events.push(structuredClone(event));
    return Promise.resolve();
  }

  findByAccountId(accountId: string): Promise<LifecycleEvent[]> {
    return Promise.resolve(this.events.filter((event) => event.accountId === accountId));
  }
}

function makePersona(id: string): Persona {
  return {
    id,
    timezone: 'UTC',
    locale: 'en',
    niche: 'cooking',
    tone: 'friendly',
    topics: ['recipes'],
    audience: 'home cooks',
    activityWindow: { startHour: 9, endHour: 21, weekendActive: true },
  };
}

interface Setup {
  service: IntakeService;
  repository: InMemoryIntakeRepository;
  accounts: FakeAccountRepository;
  personas: FakePersonaRepository;
  events: FakeEventStore;
  setNow(date: Date): void;
}

function setup(options: { personas?: boolean; events?: boolean } = {}): Setup {
  const repository = new InMemoryIntakeRepository();
  const accounts = new FakeAccountRepository();
  const personas = new FakePersonaRepository();
  const events = new FakeEventStore();
  personas.items.set('persona_1', makePersona('persona_1'));
  personas.items.set('persona_2', makePersona('persona_2'));

  let current = NOW;
  const service = new IntakeService({
    repository,
    accounts,
    ...(options.personas === false ? {} : { personas }),
    ...(options.events === false ? {} : { events }),
    clock: { now: () => new Date(current) },
  });
  return {
    service,
    repository,
    accounts,
    personas,
    events,
    setNow: (date) => {
      current = date;
    },
  };
}

const DRAFT_INPUT: CreateIntakeDraftInput = {
  platform: 'telegram',
  externalAccountId: 'ext_1',
  externalUsername: 'someone',
};

async function approved(
  service: IntakeService,
  input: CreateIntakeDraftInput = DRAFT_INPUT,
): Promise<IntakeRequest> {
  const draft = await service.createDraft(input);
  await service.submitForReview(draft.id, { ownershipConfirmed: true });
  return service.approve(draft.id, { confirmOwnership: true });
}

let ctx: Setup;

beforeEach(() => {
  ctx = setup();
});

describe('IntakeService.createDraft', () => {
  it('creates a request in the draft status', async () => {
    const request = await ctx.service.createDraft(DRAFT_INPUT);

    expect(request).toMatchObject({
      status: 'draft',
      platform: 'telegram',
      externalAccountId: 'ext_1',
      externalUsername: 'someone',
      source: 'manual',
      ownershipConfirmed: false,
    });
  });

  it('generates an id', async () => {
    const first = await ctx.service.createDraft(DRAFT_INPUT);
    const second = await ctx.service.createDraft(DRAFT_INPUT);

    expect(first.id).toMatch(UUID_PATTERN);
    expect(first.id).not.toBe(second.id);
  });

  it('takes the time from the clock', async () => {
    const request = await ctx.service.createDraft(DRAFT_INPUT);

    expect(request.createdAt).toBe(NOW_ISO);
    expect(request.updatedAt).toBe(NOW_ISO);
  });

  it('stores the request', async () => {
    const request = await ctx.service.createDraft(DRAFT_INPUT);

    expect(await ctx.repository.getById(request.id)).toEqual(request);
  });

  it('validates the input and stores nothing when it is invalid', async () => {
    await expect(
      ctx.service.createDraft({ platform: 'facebook' as unknown as Platform }),
    ).rejects.toThrow(IntakeValidationError);
    await expect(
      ctx.service.createDraft({ ...DRAFT_INPUT, externalAccountId: '' }),
    ).rejects.toThrow(IntakeValidationError);

    expect(await ctx.repository.findByStatus('draft')).toEqual([]);
  });

  it('does not change or keep references to its input', async () => {
    const metadata = { batch: 1 };
    const input = Object.freeze({ ...DRAFT_INPUT, metadata });

    const request = await ctx.service.createDraft(input);
    metadata.batch = 2;

    expect(request.metadata).toEqual({ batch: 1 });
  });
});

describe('IntakeService.getRequest', () => {
  it('returns a stored request', async () => {
    const request = await ctx.service.createDraft(DRAFT_INPUT);

    expect(await ctx.service.getRequest(request.id)).toEqual(request);
  });

  it('returns null for an unknown request', async () => {
    expect(await ctx.service.getRequest('missing')).toBeNull();
  });
});

describe('IntakeService.submitForReview', () => {
  it('moves draft -> pending_review', async () => {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    ctx.setNow(new Date('2026-07-01T13:00:00.000Z'));

    const submitted = await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });

    expect(submitted.status).toBe('pending_review');
    expect(submitted.ownershipConfirmed).toBe(true);
    expect(submitted.submittedAt).toBe('2026-07-01T13:00:00.000Z');
    expect(submitted.updatedAt).toBe('2026-07-01T13:00:00.000Z');
    expect(submitted.createdAt).toBe(NOW_ISO);
    expect(await ctx.repository.getById(draft.id)).toEqual(submitted);
  });

  it.each([false, undefined, 'yes', 1])(
    'requires ownershipConfirmed: true, not %j',
    async (value) => {
      const draft = await ctx.service.createDraft(DRAFT_INPUT);

      await expect(
        ctx.service.submitForReview(draft.id, { ownershipConfirmed: value as unknown as boolean }),
      ).rejects.toThrow(IntakeValidationError);

      const stored = await ctx.repository.getById(draft.id);
      expect(stored).toMatchObject({
        status: 'draft',
        ownershipConfirmed: false,
        submittedAt: null,
      });
    },
  );

  it('throws an IntakeNotFoundError for an unknown request', async () => {
    const attempt = ctx.service.submitForReview('missing', { ownershipConfirmed: true });

    await expect(attempt).rejects.toThrow(IntakeNotFoundError);
    await expect(attempt).rejects.toMatchObject({ requestId: 'missing' });
  });

  it('throws an InvalidIntakeTransitionError from any other status', async () => {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });

    await expect(
      ctx.service.submitForReview(draft.id, { ownershipConfirmed: true }),
    ).rejects.toThrow(InvalidIntakeTransitionError);
  });

  it('checks the transition before the confirmation', async () => {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });

    await expect(
      ctx.service.submitForReview(draft.id, { ownershipConfirmed: false }),
    ).rejects.toThrow(InvalidIntakeTransitionError);
  });
});

describe('IntakeService.approve', () => {
  async function pending(): Promise<IntakeRequest> {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    return ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });
  }

  it('moves pending_review -> approved', async () => {
    const request = await pending();
    ctx.setNow(new Date('2026-07-01T14:00:00.000Z'));

    const result = await ctx.service.approve(request.id, { confirmOwnership: true });

    expect(result.status).toBe('approved');
    expect(result.reviewedAt).toBe('2026-07-01T14:00:00.000Z');
    expect(result.updatedAt).toBe('2026-07-01T14:00:00.000Z');
    expect(await ctx.repository.getById(request.id)).toEqual(result);
  });

  it.each([false, undefined, 'yes', 1])(
    'requires confirmOwnership: true, not %j',
    async (value) => {
      const request = await pending();

      await expect(
        ctx.service.approve(request.id, { confirmOwnership: value as unknown as boolean }),
      ).rejects.toThrow(IntakeValidationError);

      expect(await ctx.repository.getById(request.id)).toMatchObject({
        status: 'pending_review',
        reviewedAt: null,
      });
    },
  );

  it('keeps the reviewer note in the metadata', async () => {
    const request = await pending();

    const result = await ctx.service.approve(request.id, {
      confirmOwnership: true,
      reviewerNote: 'verified through the account owner',
    });

    expect(result.metadata).toEqual({ reviewerNote: 'verified through the account owner' });
  });

  it('leaves the metadata alone without a reviewer note', async () => {
    const draft = await ctx.service.createDraft({ ...DRAFT_INPUT, metadata: { batch: 1 } });
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });

    const result = await ctx.service.approve(draft.id, { confirmOwnership: true });

    expect(result.metadata).toEqual({ batch: 1 });
  });

  it('throws an IntakeNotFoundError for an unknown request', async () => {
    await expect(ctx.service.approve('missing', { confirmOwnership: true })).rejects.toThrow(
      IntakeNotFoundError,
    );
  });

  it.each(['draft', 'approved', 'rejected', 'completed'] as const)(
    'throws an InvalidIntakeTransitionError for a request in the %s status',
    async (status) => {
      const request = await ctx.service.createDraft(DRAFT_INPUT);
      await ctx.repository.save({ ...request, status });

      await expect(ctx.service.approve(request.id, { confirmOwnership: true })).rejects.toThrow(
        InvalidIntakeTransitionError,
      );
    },
  );
});

describe('IntakeService.reject', () => {
  it('moves pending_review -> rejected', async () => {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });
    ctx.setNow(new Date('2026-07-01T14:00:00.000Z'));

    const result = await ctx.service.reject(draft.id, {
      reason: 'ownership could not be verified',
    });

    expect(result).toMatchObject({
      status: 'rejected',
      rejectionReason: 'ownership could not be verified',
      reviewedAt: '2026-07-01T14:00:00.000Z',
      updatedAt: '2026-07-01T14:00:00.000Z',
    });
    expect(await ctx.repository.getById(draft.id)).toEqual(result);
  });

  it('moves approved -> rejected and keeps the time of the earlier review', async () => {
    const request = await approved(ctx.service);
    ctx.setNow(new Date('2026-07-02T09:00:00.000Z'));

    const result = await ctx.service.reject(request.id, { reason: 'second thoughts' });

    expect(result.status).toBe('rejected');
    expect(result.reviewedAt).toBe(request.reviewedAt);
    expect(result.updatedAt).toBe('2026-07-02T09:00:00.000Z');
  });

  it.each(['', '   ', undefined, 5])('requires a non-empty reason, not %j', async (reason) => {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });

    await expect(
      ctx.service.reject(draft.id, { reason: reason as unknown as string }),
    ).rejects.toThrow(IntakeValidationError);

    expect(await ctx.repository.getById(draft.id)).toMatchObject({
      status: 'pending_review',
      rejectionReason: null,
    });
  });

  it('stores the reason without surrounding spaces', async () => {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });

    const result = await ctx.service.reject(draft.id, { reason: '  not the owner  ' });

    expect(result.rejectionReason).toBe('not the owner');
  });

  it('throws an IntakeNotFoundError for an unknown request', async () => {
    await expect(ctx.service.reject('missing', { reason: 'x' })).rejects.toThrow(
      IntakeNotFoundError,
    );
  });

  it.each(['draft', 'rejected', 'completed'] as const)(
    'throws an InvalidIntakeTransitionError for a request in the %s status',
    async (status) => {
      const request = await ctx.service.createDraft(DRAFT_INPUT);
      await ctx.repository.save({ ...request, status });

      await expect(ctx.service.reject(request.id, { reason: 'x' })).rejects.toThrow(
        InvalidIntakeTransitionError,
      );
    },
  );
});

describe('IntakeService.reopen', () => {
  async function rejected(): Promise<IntakeRequest> {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });
    return ctx.service.reject(draft.id, { reason: 'ownership could not be verified' });
  }

  it('moves rejected -> draft', async () => {
    const request = await rejected();
    ctx.setNow(new Date('2026-07-03T10:00:00.000Z'));

    const result = await ctx.service.reopen(request.id);

    expect(result.status).toBe('draft');
    expect(result.updatedAt).toBe('2026-07-03T10:00:00.000Z');
    expect(await ctx.repository.getById(request.id)).toEqual(result);
  });

  it('clears the rejection reason', async () => {
    const request = await rejected();
    expect(request.rejectionReason).not.toBeNull();

    expect((await ctx.service.reopen(request.id)).rejectionReason).toBeNull();
  });

  it('lets the request go through the review again', async () => {
    const request = await rejected();
    await ctx.service.reopen(request.id);

    const submitted = await ctx.service.submitForReview(request.id, { ownershipConfirmed: true });

    expect(submitted.status).toBe('pending_review');
  });

  it('throws an IntakeNotFoundError for an unknown request', async () => {
    await expect(ctx.service.reopen('missing')).rejects.toThrow(IntakeNotFoundError);
  });

  it.each(['draft', 'pending_review', 'approved', 'completed'] as const)(
    'throws an InvalidIntakeTransitionError for a request in the %s status',
    async (status) => {
      const request = await ctx.service.createDraft(DRAFT_INPUT);
      await ctx.repository.save({ ...request, status });

      await expect(ctx.service.reopen(request.id)).rejects.toThrow(InvalidIntakeTransitionError);
    },
  );
});

describe('IntakeService.complete', () => {
  it('creates an account in the connected status', async () => {
    const request = await approved(ctx.service);
    ctx.setNow(new Date('2026-07-05T10:00:00.000Z'));

    const { account } = await ctx.service.complete(request.id);

    expect(account).toEqual({
      id: expect.stringMatching(UUID_PATTERN) as string,
      platform: 'telegram',
      status: 'connected',
      personaId: null,
      deviceProfileId: null,
      proxyBindingId: null,
      createdAt: '2026-07-05T10:00:00.000Z',
      connectedAt: '2026-07-05T10:00:00.000Z',
      statusChangedAt: '2026-07-05T10:00:00.000Z',
      metadata: {
        intakeRequestId: request.id,
        intakeSource: 'manual',
        externalAccountId: 'ext_1',
        externalUsername: 'someone',
      },
    });
    expect(ctx.accounts.items.get(account.id)).toEqual(account);
  });

  it('records where an imported request came from and leaves missing external fields null', async () => {
    const request = await approved(ctx.service, { platform: 'x', source: 'import' });

    const { account } = await ctx.service.complete(request.id);

    expect(account.platform).toBe('x');
    expect(account.metadata).toEqual({
      intakeRequestId: request.id,
      intakeSource: 'import',
      externalAccountId: null,
      externalUsername: null,
    });
  });

  it('updates the request and links it to the account', async () => {
    const request = await approved(ctx.service);
    ctx.setNow(new Date('2026-07-05T10:00:00.000Z'));

    const result = await ctx.service.complete(request.id);

    expect(result.request).toMatchObject({
      id: request.id,
      status: 'completed',
      completedAt: '2026-07-05T10:00:00.000Z',
      updatedAt: '2026-07-05T10:00:00.000Z',
      completedAccountId: result.account.id,
    });
    expect(await ctx.repository.getById(request.id)).toEqual(result.request);
  });

  it('uses desiredPersonaId when no personaId is given', async () => {
    const request = await approved(ctx.service, { ...DRAFT_INPUT, desiredPersonaId: 'persona_1' });

    const { account } = await ctx.service.complete(request.id);

    expect(account.personaId).toBe('persona_1');
  });

  it('uses the given personaId over desiredPersonaId', async () => {
    const request = await approved(ctx.service, { ...DRAFT_INPUT, desiredPersonaId: 'persona_1' });

    const { account } = await ctx.service.complete(request.id, { personaId: 'persona_2' });

    expect(account.personaId).toBe('persona_2');
  });

  it('leaves the persona empty when none was asked for', async () => {
    const request = await approved(ctx.service);

    expect((await ctx.service.complete(request.id, {})).account.personaId).toBeNull();
  });

  it.each([
    ['a given personaId', { personaId: 'missing' }, undefined],
    ['the desired persona', {}, 'missing'],
  ])('throws an IntakeValidationError when %s does not exist', async (_label, input, desired) => {
    const request = await approved(ctx.service, {
      ...DRAFT_INPUT,
      ...(desired === undefined ? {} : { desiredPersonaId: desired }),
    });

    await expect(ctx.service.complete(request.id, input)).rejects.toThrow(IntakeValidationError);

    expect(ctx.accounts.items.size).toBe(0);
    expect(ctx.events.events).toEqual([]);
    expect((await ctx.repository.getById(request.id))?.status).toBe('approved');
  });

  it('does not check the persona when no persona repository was given', async () => {
    const bare = setup({ personas: false });
    const request = await approved(bare.service);

    const { account } = await bare.service.complete(request.id, { personaId: 'unverified' });

    expect(account.personaId).toBe('unverified');
  });

  it.each(['', '   '])(
    'throws an IntakeValidationError for the blank personaId %j',
    async (personaId) => {
      const request = await approved(ctx.service);

      await expect(ctx.service.complete(request.id, { personaId })).rejects.toThrow(
        IntakeValidationError,
      );
    },
  );

  it('throws a DuplicateIntakeError when a request for the same external account is already completed', async () => {
    const first = await approved(ctx.service);
    const { account } = await ctx.service.complete(first.id);
    const second = await approved(ctx.service);

    const attempt = ctx.service.complete(second.id);

    await expect(attempt).rejects.toThrow(DuplicateIntakeError);
    await expect(attempt).rejects.toMatchObject({
      platform: 'telegram',
      externalAccountId: 'ext_1',
      existingRequestId: first.id,
    });
    expect(ctx.accounts.items.size).toBe(1);
    expect(ctx.accounts.items.has(account.id)).toBe(true);
    expect((await ctx.repository.getById(second.id))?.status).toBe('approved');
    expect(ctx.events.events).toHaveLength(1);
  });

  it('does not treat requests that are not completed as duplicates', async () => {
    const first = await approved(ctx.service);
    const second = await approved(ctx.service);

    expect((await ctx.service.complete(first.id)).account.id).toBeDefined();
    await expect(ctx.service.complete(second.id)).rejects.toThrow(DuplicateIntakeError);
  });

  it('allows the same external id on another platform', async () => {
    const telegram = await approved(ctx.service);
    const x = await approved(ctx.service, { ...DRAFT_INPUT, platform: 'x' });

    await ctx.service.complete(telegram.id);

    await expect(ctx.service.complete(x.id)).resolves.toBeDefined();
  });

  it('never treats requests without an external id as duplicates', async () => {
    const first = await approved(ctx.service, { platform: 'telegram' });
    const second = await approved(ctx.service, { platform: 'telegram' });

    await ctx.service.complete(first.id);

    await expect(ctx.service.complete(second.id)).resolves.toBeDefined();
    expect(ctx.accounts.items.size).toBe(2);
  });

  it('records a state_changed event when an event store was given', async () => {
    const request = await approved(ctx.service);
    ctx.setNow(new Date('2026-07-05T10:00:00.000Z'));

    const { account } = await ctx.service.complete(request.id);

    expect(ctx.events.events).toEqual([
      {
        id: expect.stringMatching(UUID_PATTERN) as string,
        accountId: account.id,
        type: 'state_changed',
        payload: {
          from: null,
          to: 'connected',
          source: 'account-intake',
          intakeRequestId: request.id,
        },
        createdAt: '2026-07-05T10:00:00.000Z',
      },
    ]);
  });

  it('works without an event store', async () => {
    const bare = setup({ events: false });
    const request = await approved(bare.service);

    await expect(bare.service.complete(request.id)).resolves.toBeDefined();
    expect(bare.events.events).toEqual([]);
  });

  it('saves completedAccountId in the request', async () => {
    const request = await approved(ctx.service);

    const { account } = await ctx.service.complete(request.id);

    expect((await ctx.repository.getById(request.id))?.completedAccountId).toBe(account.id);
  });

  it('throws an IntakeNotFoundError for an unknown request', async () => {
    await expect(ctx.service.complete('missing')).rejects.toThrow(IntakeNotFoundError);
  });

  it.each(['draft', 'pending_review', 'rejected', 'completed'] as const)(
    'throws an InvalidIntakeTransitionError for a request in the %s status',
    async (status) => {
      const request = await ctx.service.createDraft(DRAFT_INPUT);
      await ctx.repository.save({ ...request, status, ownershipConfirmed: true });

      await expect(ctx.service.complete(request.id)).rejects.toThrow(InvalidIntakeTransitionError);
      expect(ctx.accounts.items.size).toBe(0);
    },
  );

  it('refuses to complete a request whose ownership was never confirmed', async () => {
    const request = await ctx.service.createDraft(DRAFT_INPUT);
    await ctx.repository.save({ ...request, status: 'approved', ownershipConfirmed: false });

    await expect(ctx.service.complete(request.id)).rejects.toThrow(IntakeValidationError);
    expect(ctx.accounts.items.size).toBe(0);
  });

  it('only works once: a request cannot be completed twice', async () => {
    const request = await approved(ctx.service);
    await ctx.service.complete(request.id);

    await expect(ctx.service.complete(request.id)).rejects.toThrow(InvalidIntakeTransitionError);
    expect(ctx.accounts.items.size).toBe(1);
  });

  it('does not change what it was given', async () => {
    const request = await approved(ctx.service);
    const input = Object.freeze({ personaId: 'persona_1' });

    await ctx.service.complete(request.id, input);

    expect(input).toEqual({ personaId: 'persona_1' });
  });

  describe('when calls overlap', () => {
    it('completes a request only once, even when asked twice at the same time', async () => {
      const request = await approved(ctx.service);

      const results = await Promise.allSettled([
        ctx.service.complete(request.id),
        ctx.service.complete(request.id),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(ctx.accounts.items.size).toBe(1);
      expect(ctx.events.events).toHaveLength(1);
    });

    it('accepts only one of two requests for the same external account', async () => {
      const first = await approved(ctx.service);
      const second = await approved(ctx.service);

      const results = await Promise.allSettled([
        ctx.service.complete(first.id),
        ctx.service.complete(second.id),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(
        DuplicateIntakeError,
      );
      expect(ctx.accounts.items.size).toBe(1);
    });

    it('keeps working after a call failed', async () => {
      const request = await approved(ctx.service);

      await expect(ctx.service.complete('missing')).rejects.toThrow(IntakeNotFoundError);

      await expect(ctx.service.complete(request.id)).resolves.toBeDefined();
    });
  });
});

describe('the whole intake', () => {
  it('goes draft -> pending_review -> approved -> completed', async () => {
    const draft = await ctx.service.createDraft({ ...DRAFT_INPUT, desiredPersonaId: 'persona_1' });
    const submitted = await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });
    const approvedRequest = await ctx.service.approve(draft.id, { confirmOwnership: true });
    const { request, account } = await ctx.service.complete(draft.id);

    expect([draft.status, submitted.status, approvedRequest.status, request.status]).toEqual([
      'draft',
      'pending_review',
      'approved',
      'completed',
    ]);
    expect(account).toMatchObject({ status: 'connected', personaId: 'persona_1' });
  });

  it('supports a rejection, a correction and a second review', async () => {
    const draft = await ctx.service.createDraft(DRAFT_INPUT);
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });
    await ctx.service.reject(draft.id, { reason: 'wrong username' });
    await ctx.service.reopen(draft.id);
    await ctx.service.submitForReview(draft.id, { ownershipConfirmed: true });
    await ctx.service.approve(draft.id, { confirmOwnership: true });

    const { request } = await ctx.service.complete(draft.id);

    expect(request.status).toBe('completed');
    expect(request.rejectionReason).toBeNull();
  });
});

describe('errors and clocks', () => {
  it('make every intake error a domain error', () => {
    for (const error of [
      new IntakeNotFoundError('x'),
      new IntakeValidationError('x'),
      new DuplicateIntakeError('telegram', 'ext', 'req'),
    ]) {
      expect(error).toBeInstanceOf(IntakeError);
      expect(error).toBeInstanceOf(DomainError);
    }
  });

  it('createIntakeFixedClock always returns the same moment, as a fresh Date', () => {
    const clock = createIntakeFixedClock(NOW);

    clock.now().setUTCFullYear(1999);

    expect(clock.now().toISOString()).toBe(NOW_ISO);
    expect(clock.now()).not.toBe(clock.now());
  });

  it('createIntakeFixedClock rejects an invalid date', () => {
    expect(() => createIntakeFixedClock(new Date('nope'))).toThrow(IntakeValidationError);
  });

  it('createIntakeSystemClock follows the real time', () => {
    const before = Date.now();
    const now = createIntakeSystemClock().now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('a service without a clock uses the system time', async () => {
    const service = new IntakeService({
      repository: new InMemoryIntakeRepository(),
      accounts: new FakeAccountRepository(),
    });
    const before = Date.now();

    const request = await service.createDraft(DRAFT_INPUT);

    expect(Date.parse(request.createdAt)).toBeGreaterThanOrEqual(before);
  });
});
