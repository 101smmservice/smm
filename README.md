# Persona

Persona — account portfolio management platform.

The platform manages a portfolio of accounts: their domain model, lifecycle, events and the
policies that describe how each account is operated. This repository is a pnpm + Turborepo
monorepo.

## Current status

Three packages are being developed at the moment:

- [`packages/core`](packages/core) (`@persona/core`) — pure domain logic and the foundation for all
  other modules: domain types (`Account`, `Persona`, `ActivityPolicy`, `DailyPlan`, …), the account
  lifecycle state machine, lifecycle events, action and action-sequence types, engine contracts,
  storage contracts (interfaces only) and typed domain errors. No runtime dependencies, no I/O.
- [`packages/persona-engine`](packages/persona-engine) (`@persona/persona-engine`) — the activity
  policy engine: picks the policy for an account status, builds daily plans, checks and records
  action budgets, and loads policies from YAML.
- [`packages/behavior`](packages/behavior) (`@persona/behavior`) — builds the ordered sequence of
  actions and pauses inside a single session without exceeding the daily budgets.

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
```

Workspaces are declared in `pnpm-workspace.yaml` (`packages/*`, `services/*`). Project rules live in
[`CLAUDE.md`](CLAUDE.md).
