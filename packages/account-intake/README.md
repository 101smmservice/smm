# @persona/account-intake

Manual intake of accounts into the system.

- Implements the manual intake of accounts: an intake request records that an existing account is
  being brought into the portfolio, a person reviews it, and only then is the account record created.
- Performs no automatic registration. Nothing in this package creates an account on a platform.
- Has no integrations with platforms and makes no network calls.
- Requires a confirmation of ownership: the submitter confirms that they own the account when they
  submit the request, and the reviewer confirms it again when they approve it.
- Depends only on `@persona/core`.

## Request statuses

```txt
draft           -> pending_review
pending_review  -> approved, rejected
approved        -> completed, rejected
rejected        -> draft
completed       -> (nothing)
```

Every other transition is forbidden. `requiresOwnershipConfirmation(from, to)` is `true` for
`draft -> pending_review` and for `approved -> completed`.

| Step              | What it takes                                                              |
| ----------------- | -------------------------------------------------------------------------- |
| `submitForReview` | `ownershipConfirmed: true`                                                 |
| `approve`         | `confirmOwnership: true`; an optional `reviewerNote` is kept in `metadata` |
| `reject`          | a non-empty `reason`                                                       |
| `reopen`          | nothing; clears the rejection reason                                       |
| `complete`        | an `approved` request whose ownership was confirmed                        |

`complete` creates an `Account` in the `connected` status, links it to the request
(`completedAccountId`, and `metadata.intakeRequestId` on the account) and, when an event store is
given, records a `state_changed` event (`from: null`, `to: 'connected'`, `source: 'account-intake'`).

- The persona is `input.personaId`, else the one the request asked for (`desiredPersonaId`). It is
  checked against the persona repository when one was given.
- Two requests for the same platform and external account cannot both be completed: the second one
  fails with a `DuplicateIntakeError`.
- Operations that change a request run one after another, so overlapping calls cannot complete the
  same request, or two requests for the same account, twice.

## Usage

```ts
import { InMemoryIntakeRepository, IntakeService } from '@persona/account-intake';

const service = new IntakeService({
  repository: new InMemoryIntakeRepository(),
  accounts, // an AccountRepository from @persona/core
  personas, // optional PersonaRepository
  events, // optional LifecycleEventStore
});

const draft = await service.createDraft({
  platform: 'telegram',
  externalAccountId: '12345',
  externalUsername: 'someone',
  desiredPersonaId: 'persona_1',
});

await service.submitForReview(draft.id, { ownershipConfirmed: true });
await service.approve(draft.id, {
  confirmOwnership: true,
  reviewerNote: 'verified with the owner',
});

const { request, account } = await service.complete(draft.id);
// request.status === 'completed', account.status === 'connected'
```

## Errors

All errors extend `IntakeError`, which extends `DomainError` from `@persona/core`:
`IntakeNotFoundError`, `InvalidIntakeTransitionError`, `IntakeValidationError` and
`DuplicateIntakeError`.
