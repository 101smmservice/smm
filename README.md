# Persona

Persona — account portfolio management platform.

The platform manages a portfolio of accounts: their domain model, lifecycle, events and the
policies that describe how each account is operated. This repository is a pnpm + Turborepo
monorepo.

## Current status

Only [`packages/core`](packages/core) (`@persona/core`) is being developed at the moment. It holds
the pure domain logic and is the foundation for all future modules:

- domain types (`Account`, `Persona`, `ActivityPolicy`, `DailyPlan`, `DeviceProfile`, …);
- the account lifecycle state machine;
- lifecycle events and the event factory;
- storage contracts (repository interfaces, no implementations);
- typed domain errors.

`@persona/core` has no runtime dependencies and performs no I/O.

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
packages/
  core/        # @persona/core — domain model, state machine, events, storage contracts
```

Workspaces are declared in `pnpm-workspace.yaml` (`packages/*`, `services/*`). Project rules live in
[`CLAUDE.md`](CLAUDE.md).
