# MRP v2 Phase 2a: branch audit fixes

Source: the self-review of `naveenkash/mrp-v2-research` (2026-11-26). Fix every Must fix,
cleanup and docs finding; verify every risk and question (fix the ones that are defects,
report the design questions with evidence and a recommendation).

Behaviour is preserved except where a finding is a defect. Heavy checks (erp typecheck,
`pnpm generate:mcp`, `pnpm check:manifest`) run once, by the main agent, at the end.

## Wave 1 (parallel, disjoint files)

- [x] **E1 Engine correctness** — `packages/planning/src/mrp/**`, `packages/database/src/mrp-engine.ts`,
      `packages/jobs/src/inngest/functions/scheduled/mrp-companies.ts`, new race test under
      `apps/erp/test/database/`, `packages/checks/guarded-code.json`.
      Stored `lowLevelCode` = engine level; log a failed write once; worklist reuses the run's open
      supply read; held Transfer orders not counted as Buy; scrap rate for every exploded item;
      Planned rows count as planning work; two-connection run-vs-convert race test + registration.
      Verify: retry re-reads (today, periods, locations), the two "which week" rules.
- [x] **P1 Planning server** — `production.server.ts`, `production.service.ts`, `production.utils.ts`,
      `production.models.ts`, `purchasing.server.ts`, `api+/production.planning-open-jobs.ts`.
      Purchasing Apply gate for Buy planned orders (Material Planning Edit, per row); Apply never
      answers 500 after a committed write (both modules); one shared planned-order apply helper;
      typed narrowing instead of the cast; dead exports; TSDoc fixes; open-jobs query into the
      service; one location fence read. Verify: due date in the past, Jobs Edit on planned-order-only
      batches, the duplicated past-week rule, MRP per click.
- [x] **C1 Items / resources / open lines** — `api+/purchasing.planning-open-lines.ts`, `items/**`,
      the four item planning routes, `resources/**`, location routes, purchasing / items / resources
      AGENTS.md. Status filter and paging on open lines; `updateItemPlanning` keeps an omitted fence;
      `upsertLocation` scoping; log a failed fence read; one shared item planning loader piece.
- [x] **D1 Schema, tests, docs** — `20261126091510_planned-order.sql`, `20261126091514_*.sql`,
      `packages/jobs/src/backups/id-refs.ts`, `apps/erp/test/database/{convert-planned-orders,planned-order-firm}.test.ts`,
      new `apps/erp/test/database/fixtures/planning.ts`, glossary, `.claude/rules/mrp-system.md`,
      `.claude/rules/clientAction-patterns.md`, `.ai/lessons.md`, the plan and playbook, `planning.mdx`.
      Partial indexes; id-ref entry; missing guard tests (scrap restatement, foreign company, batch
      refusals); test de-duplication onto shared fixtures; stale docs.

## Wave 2 (parallel, after wave 1)

- [x] **U2 Planning UI** — `production/ui/Planning/**`, `purchasing/ui/Planning/**`.
      Shared hooks for the drawers' edit overlay, cell save and orphan rows, and the grids' bulk
      planned-order read and draft state; split `PlanningOrderGrids.tsx` and the purchasing drawer;
      `useAction` in the purchasing drawer; `Math.ceil` → `round(…, Up)`; a failed bulk read logs and
      toasts; horizon props renamed.
- [x] **E2 Engine structure** — `packages/planning/src/mrp/**`. Split `planning-actions.ts` and
      `mrp.ts`; one week helper; shared `isInlineProduction` / child demand; one snapshot reader; one
      policy conversion; drop the barrel and the `jsonEquals` import cycle; test fixes.

## Wave 3 (main agent)

- [x] erp typecheck, scoped tests, oxlint / oxfmt, conformance checks, translations, commit, push.
