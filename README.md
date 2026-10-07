# Persona

Persona — account portfolio management platform.

The platform manages a portfolio of accounts: their domain model, lifecycle, events and the
policies that describe how each account is operated. This repository is a pnpm + Turborepo
monorepo.

## Current status

Six packages and one service are being developed at the moment:

- [`packages/core`](packages/core) (`@persona/core`) — pure domain logic and the foundation for all
  other modules: domain types (`Account`, `Persona`, `ActivityPolicy`, `DailyPlan`, …), the account
  lifecycle state machine, lifecycle events, action and action-sequence types, engine contracts,
  storage contracts (interfaces only) and typed domain errors. No runtime dependencies, no I/O.
- [`packages/persona-engine`](packages/persona-engine) (`@persona/persona-engine`) — the activity
  policy engine: picks the policy for an account status, builds daily plans, checks and records
  action budgets, and loads policies from YAML.
- [`packages/behavior`](packages/behavior) (`@persona/behavior`) — builds the ordered sequence of
  actions and pauses inside a single session without exceeding the daily budgets.
- [`packages/analytics`](packages/analytics) (`@persona/analytics`) — lifecycle and portfolio
  metrics: status summary, transition matrix, restriction frequency, action failure rate and cohort
  survival, computed over in-memory data.
- [`packages/publisher`](packages/publisher) (`@persona/publisher`) — content pipeline: planning
  and the record of publications. It publishes nothing itself; the `published` status confirms a
  publication.
- [`packages/account-intake`](packages/account-intake) (`@persona/account-intake`) — manual intake of
  accounts into the system: a request is submitted with a confirmation of ownership, reviewed, and
  only then turned into an account record. It registers nothing on any platform.
- [`services/control-api`](services/control-api) (`@persona/control-api`) — a local service for
  managing the account portfolio: accounts, manual account intake, personas, manual status changes,
  policies and daily plans, the content pipeline, events and the analytics snapshot. It keeps data in memory and
  performs no action on any platform.

Activity policies are configuration: see [`config/policies.yaml`](config/policies.yaml).

## Stack

Node.js 20+, TypeScript 5 (strict, ESM), pnpm workspaces, Turborepo, ESLint, Prettier, Vitest.

## Getting started

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Formatting: `pnpm format` (write) / `pnpm format:check` (verify).

## Repository layout

```txt
config/
  policies.yaml  # activity policies per lifecycle stage
packages/
  core/            # @persona/core — domain model, state machine, events, contracts
  persona-engine/  # @persona/persona-engine — policies, daily plans, action budgets
  behavior/        # @persona/behavior — action sequences within a session
  analytics/       # @persona/analytics — lifecycle and portfolio metrics
  publisher/       # @persona/publisher — content pipeline, planning and publication records
  account-intake/  # @persona/account-intake — manual account intake
services/
  control-api/     # @persona/control-api — local portfolio management service (Fastify)
```

Workspaces are declared in `pnpm-workspace.yaml` (`packages/*`, `services/*`). Project rules live in
[`CLAUDE.md`](CLAUDE.md).
