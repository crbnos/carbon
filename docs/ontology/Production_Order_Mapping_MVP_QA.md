# Production Order Mapping MVP QA

## Scope

Documentation and pure `@carbon/utils` contract changes only. No ERP workflow,
MES workflow, P1 shell, P2 UI, database, migration, service, sync job or
production record changed.

## Commands

| Check | Command | Result |
| --- | --- | --- |
| Dependency setup | `pnpm install --frozen-lockfile` | PASS |
| Test config setup | `pnpm --filter @carbon/config build` | PASS |
| TDD RED | `pnpm --filter @carbon/utils exec vitest run src/production-order-mapping.test.ts` before implementation | PASS — failed because the module did not exist |
| Focused tests | `pnpm --filter @carbon/utils exec vitest run src/production-order-mapping.test.ts` | PASS — 10/10 |
| Utils typecheck | `pnpm --filter @carbon/utils typecheck` | PASS |
| Biome | `pnpm exec biome check packages/utils/src/production-order-mapping.ts packages/utils/src/production-order-mapping.fixtures.ts packages/utils/src/production-order-mapping.test.ts` | PASS — 3 files |
| Full utils tests | `pnpm --filter @carbon/utils test` | PASS — 12 files / 155 tests |
| Diff hygiene | `git diff --check` | PASS |

## Safety assertions

- ERP-only projection does not infer execution.
- MES-only projection remains `unlinked`.
- Only exact confirmed lineage merges.
- Mismatched confirmed lineage becomes `conflict`.
- Unknown statuses remain `unknown`.
- Source objects remain unchanged.
- The 1/1/0 regression never creates canonical completed quantity or progress.

## Gate posture

This MVP proves a safe semantic mapping contract and synthetic golden paths. It
does not prove a live ERPNext integration. If final repository checks fail, the
result remains `PARTIAL`/`P2_BLOCKED` and no P2 UI is started.

## Final result

`PARTIAL`: the pure mapping MVP, explicit lineage contract, authority-aware
merge, registry validation, three sanitized fixtures and tests are implemented.
`P2_BLOCKED`: no runtime ERPNext Work Order → Carbon Job lineage is proven, so
Production Order 360 remains out of scope.
