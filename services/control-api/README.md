# @persona/control-api

A local control service for managing the account portfolio.

- It is a local control loop: it keeps the books of accounts, personas, content and events, and lets
  an operator move accounts through their lifecycle, look at policies and daily plans, and read an
  analytics snapshot.
- It performs no actions on any platform. It has no actors, uses no proxies, and makes no network
  calls to Instagram, TikTok, X or Telegram.
- It does not publish content. For content, `published` only **records and confirms** that a
  publication happened elsewhere, and has to be confirmed explicitly with `confirm: true`.
- It keeps all data in memory, not in a database. Everything is lost when the process stops.
- It reuses the domain logic of `@persona/core`, `@persona/persona-engine`, `@persona/publisher`,
  `@persona/analytics` and `@persona/account-intake`.
- Accounts can be brought in through a manual intake: a request is submitted with a confirmation of
  ownership, approved by a reviewer and then completed, which adds the account record. Nothing is
  registered on a platform.

## Run

```bash
pnpm --filter @persona/control-api dev
```

The server listens on `127.0.0.1:3000`; override with the `HOST` and `PORT` environment variables.
It needs no internet access. For a production-style run, `pnpm build` and then
`pnpm --filter @persona/control-api start`.

Activity policies are read from `config/policies.yaml`. If that file is missing the service starts
with no policies (every account then has the empty policy); a file that exists but is invalid stops
the start.

## Test

```bash
pnpm --filter @persona/control-api test
```

The tests drive the app with `app.inject(...)`, so no server is started. The clock and the random
number generator are injected, which keeps them deterministic.

## Routes

`GET /` returns this list.

| Method  | Path                                     | Purpose                                                     |
| ------- | ---------------------------------------- | ----------------------------------------------------------- |
| `GET`   | `/health`                                | Liveness check                                              |
| `POST`  | `/accounts`                              | Create an account (status `connected`)                      |
| `GET`   | `/accounts`                              | List accounts, optional `?status=`                          |
| `GET`   | `/accounts/:accountId`                   | Get an account                                              |
| `POST`  | `/accounts/:accountId/transition`        | Move an account to another status                           |
| `POST`  | `/accounts/:accountId/persona`           | Assign a persona                                            |
| `GET`   | `/accounts/:accountId/policy`            | Activity policy of the account                              |
| `GET`   | `/accounts/:accountId/plan`              | Daily plan, `?date=YYYY-MM-DD`                              |
| `GET`   | `/accounts/:accountId/action-permission` | Whether `?action=` is allowed by the daily budget           |
| `GET`   | `/accounts/:accountId/content-plan`      | Content plan, `?date=YYYY-MM-DD`                            |
| `POST`  | `/personas`                              | Create a persona                                            |
| `GET`   | `/personas`                              | List personas                                               |
| `GET`   | `/personas/:personaId`                   | Get a persona                                               |
| `PATCH` | `/personas/:personaId`                   | Update some fields of a persona                             |
| `POST`  | `/content`                               | Create a content draft                                      |
| `GET`   | `/content/:contentId`                    | Get a content item                                          |
| `POST`  | `/content/:contentId/transition`         | Move a content item to another status                       |
| `POST`  | `/content/:contentId/published`          | Confirm a publication (needs `confirm: true`)               |
| `POST`  | `/content/:contentId/failed`             | Record that a publication failed                            |
| `POST`  | `/events`                                | Record a lifecycle event                                    |
| `GET`   | `/events`                                | List events (`accountId`, `type`, `startDate`, `endDate`)   |
| `GET`   | `/analytics/snapshot`                    | Analytics snapshot (`startDate`, `endDate`, `survivalDays`) |

## Behavior worth knowing

- **Manual confirmation.** `review -> warming` for accounts and `scheduled -> published` for content
  need `confirm: true`; otherwise the answer is `409 manual_confirmation_required`.
- **Intake.** Submitting needs `ownershipConfirmed: true` (otherwise `400`). Approving without
  `confirmOwnership: true` is a `409 manual_confirmation_required`. Completing creates the account in
  the `connected` status, records a `state_changed` event (`source: 'account-intake'`) and answers
  `409 duplicate_intake` when a request for the same platform and external account is already
  completed.
- **Status changes of accounts** are checked by the state machine of `@persona/core` and recorded as
  a `state_changed` event with `source: 'control-api'`.
- **Plans are cached per account and date** by the persona engine for the life of the process, so a
  plan that was already asked for does not change when the persona is edited afterwards.
- Bodies and queries are validated strictly: unknown fields are rejected, dates are real
  `YYYY-MM-DD` dates and timestamps are ISO 8601 with a UTC offset.
- A reversed date range (`startDate` after `endDate`) is a `400`. In `/analytics/snapshot` a range
  with only one end is open on the other side, and it narrows only the daily event metrics.

## Errors

Every error has one shape and never contains a stack trace:

```json
{ "error": { "code": "validation_error", "message": "Invalid body", "details": [] } }
```

| Code                           | Status  | Meaning                                                                                                |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------ |
| `validation_error`             | 400     | Body, query or path is invalid, or refers to something that is not there                               |
| `not_found`                    | 404     | The addressed entity or route does not exist                                                           |
| `invalid_transition`           | 409     | The status change is not allowed                                                                       |
| `manual_confirmation_required` | 409     | The change has to be confirmed with `confirm: true`                                                    |
| `duplicate_intake`             | 409     | A completed intake request already exists for the same account                                         |
| `domain_error`                 | 409/400 | A domain rule refuses the change, e.g. a content item that is not ready (`details` lists the problems) |
| `internal_error`               | 500     | Unexpected failure; the cause is only written to the log                                               |
