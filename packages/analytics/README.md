# @persona/analytics

Analytical metrics computed on top of the `@persona/core` domain model.

- Computes lifecycle and portfolio metrics: a status summary, a state transition matrix, restriction
  frequency, action failure rate and cohort survival, plus one function that bundles them into an
  `AnalyticsSnapshot`.
- Performs no actions and does not integrate with any platform.
- Uses no external services: no network, database, cache or queue. The only dependency is
  `@persona/core`.
- The current version works on arrays of data held in memory, which makes it suitable for reports,
  tests and a future dashboard.

## Usage

```ts
import { createAnalyticsSnapshot } from '@persona/analytics';

const snapshot = createAnalyticsSnapshot(accounts, lifecycleEvents, {
  now: new Date(),
  range: { startDate: '2026-07-01', endDate: '2026-07-31' },
  survivalDays: [1, 7, 30],
});
```

## Metrics

| Function                        | Input               | Result                                              |
| ------------------------------- | ------------------- | --------------------------------------------------- |
| `summarizeAccounts`             | accounts            | counts per status and the share of key statuses     |
| `buildTransitionMatrix`         | lifecycle events    | `from -> to` counts of `state_changed` events       |
| `calculateRestrictionFrequency` | events, `DateRange` | per day: `restriction_detected` events and accounts |
| `calculateActionFailureMetrics` | events, `DateRange` | per day: performed, failed and failure rate         |
| `calculateCohortSurvival`       | accounts, now, days | share of each cohort that is not `dead`             |
| `createAnalyticsSnapshot`       | accounts, events    | all of the above in one object                      |

Conventions:

- Dates are `YYYY-MM-DD` and day boundaries are UTC. A timestamp written with an offset is
  assigned to its UTC date.
- A `DateRange` includes both of its bounds.
- Days without matching events produce no row.
- Invalid input (a malformed date or range, an unknown account status, an unparseable timestamp)
  throws a `ValidationError`. The one exception is a `state_changed` event whose payload carries no
  valid `from` and `to` status: it is skipped.
- Cohort survival is a snapshot of the current moment, not a historical series: "alive" means the
  account's current status is not `dead`.
- Inputs are never mutated.
