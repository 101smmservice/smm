# @persona/publisher

Content pipeline for planning, preparing and recording publications.

- Implements the content pipeline: a content item moves from a draft through a brief, a plan and a
  schedule to a recorded outcome.
- Is responsible for planning and for the record of publications.
- Performs no real posting.
- The `published` status means a publication was **confirmed**, not that this package carried it out.
  The step `scheduled -> published` is flagged by `requiresManualConfirmation`: something outside the
  package publishes, and `markPublished` records that it happened.
- Has no integrations with platforms and makes no network calls.
- Depends only on `@persona/core`.

## Content statuses

```txt
draft        -> brief_ready, rejected, archived
brief_ready  -> planned, draft, rejected, archived
planned      -> ready, brief_ready, rejected, archived
ready        -> scheduled, planned, rejected, archived
scheduled    -> published, failed, ready
failed       -> planned, rejected, archived
published    -> archived
rejected     -> draft
archived     -> (nothing)
```

Every other transition is forbidden. Besides being allowed, a transition may need the item to be
ready for it (`validateContentTransition`):

| Transition               | Requirement                                             |
| ------------------------ | ------------------------------------------------------- |
| `draft -> brief_ready`   | a non-empty `brief` and at least one non-empty topic    |
| `brief_ready -> planned` | a `plannedDate` (`YYYY-MM-DD`), given or already stored |
| `planned -> ready`       | a `caption` or at least one media reference             |
| `ready -> scheduled`     | a `scheduledAt` (ISO 8601), given or already stored     |
| `scheduled -> failed`    | a non-empty `failureReason`, given or already stored    |
| `scheduled -> published` | nothing; `externalId` is optional                       |
| `scheduled -> ready`     | nothing; cancels the schedule and keeps `scheduledAt`   |
| `failed -> planned`      | nothing; keeps `failureReason` as history               |
| to `rejected`/`archived` | nothing                                                 |

All problems are reported at once, each with a `code` such as `missing_brief` or
`invalid_scheduled_at`.

## Usage

```ts
import { ContentPipeline, InMemoryContentRepository } from '@persona/publisher';

const pipeline = new ContentPipeline(new InMemoryContentRepository());

const draft = await pipeline.createDraft({
  accountId: 'acc_1',
  format: 'post',
  brief: 'Seasonal recipe',
  topics: ['cooking'],
  caption: 'Autumn soup',
});

await pipeline.transition({ id: draft.id, to: 'brief_ready' });
await pipeline.transition({ id: draft.id, to: 'planned', plannedDate: '2026-10-12' });
await pipeline.transition({ id: draft.id, to: 'ready' });
await pipeline.transition({ id: draft.id, to: 'scheduled', scheduledAt: '2026-10-12T09:00:00Z' });

// Later, once the publication has been confirmed elsewhere:
await pipeline.markPublished(draft.id, { externalId: 'ext_42' });

const plan = await pipeline.planForDate('acc_1', '2026-10-12');
```

## Notes

- Timestamps are ISO 8601 and must carry an offset (`Z` or `+hh:mm`); dates are `YYYY-MM-DD`.
- `planForDate` reports `isReady` when the day has at least one `ready`, `scheduled` or `published`
  item and no `failed` one.
- `InMemoryContentRepository` keeps everything in memory and hands out deep copies only.
- Invalid input throws a `ValidationError` from `@persona/core`; a refused status change throws a
  `ContentValidationError` (an `InvalidContentTransitionError` for a disallowed transition).
