# @carbon/checks

Conformance checking, clobber detection, invariant queries, and module structure validation for the Carbon monorepo.

## Always

- **Run checks against real migrations and module directories** — `collectFindings(root)` scans both SQL migrations and app module structure
- **Use `newViolations()` for CI** — filters findings against the baseline so only new violations fail the build
- **Add new conformance rules to `CONFORMANCE_CHECKS` or `STRUCTURE_CHECKS` arrays** — follow the `ConformanceCheck` / `StructureCheck` interface
- **Write invariants as `.sql` files** — each returns rows that VIOLATE the rule (empty = healthy); loaded from directory by `loadInvariants(dir)`

## Ask First

- Regenerating the baseline (`pnpm --filter @carbon/checks baseline`) — this grandfathers all current violations
- Adding new `OBJECT_PATTERNS` to clobber detection (extends what qualifies as a DB object redefinition)
- Modifying existing conformance checks (may affect CI gates)

## Never

- Ignore clobber warnings — they indicate a view/function/trigger is redefined on both your branch and main since the merge-base; rebase first
- Suppress violations by removing checks — add to the baseline if grandfathering is appropriate

## Validation Commands

```bash
pnpm --filter @carbon/checks test          # vitest — unit tests
pnpm --filter @carbon/checks clobbers      # check for migration clobber risks
pnpm --filter @carbon/checks invariants    # run SQL invariants against DB
pnpm --filter @carbon/checks baseline      # regenerate baseline (careful!)
```

## Key Patterns

- **Conformance checks**: `noNumericPrecision`, `noLegacyRls` — scan SQL migrations for anti-patterns; `noLocalTimezone` (in `SERVER_CHECKS`) scans server TS (`sources/server-files.ts`) for `getLocalTimeZone()`, UTC day-slicing, local date-parts of now (`new Date().getDay()` etc.), and `setHours(0,0,0,0)` midnights. Scanned files: MES services, `packages/jobs`, edge functions, ERP module `.service.ts`/`.server.ts`, **plus both apps' route trees** — route modules are server AND client in one file, so `maskClientCode` blanks the browser half (default export, `clientLoader`/`clientAction`, PascalCase/`use*` declarations) while keeping loaders, actions, and the module-level helpers they call
- **Structure checks**: `moduleShape` — validates ERP modules have `types.ts`, `ui/`, `index.ts`, `<name>.service.ts`, `<name>.models.ts`
- **Clobber detection**: `findClobbers(branch, main)` — identifies DB objects redefined on both sides
- **Baseline**: `src/baseline.ts` — grandfathered violations keyed by `checkId + file + line + snippet`
- **Invariants**: SQL queries loaded from directory, injected `Query` for testability
- **Workflows**: two DB-backed drift checks, answering different questions.
  `src/invariants/workflow-trigger-event-drift.sql` (via `pnpm --filter @carbon/checks invariants`)
  compares each active workflow's `workflowTriggerEvent` rows against its active version's trigger
  nodes — a dispatch row that is missing, orphaned, or pinned to a superseded version.
  `src/scripts/check-workflow-events.ts` (`pnpm --filter @carbon/checks workflow-events`) asks
  whether an event id a live workflow subscribes to still exists in the generated catalog — the
  shape a catalog rename leaves behind. Neither replaces the other.
  **Neither runs in CI, and neither can as CI stands**: both open a live Postgres connection
  (`DATABASE_URL` / `SUPABASE_DB_URL`), and no job in `.github/workflows/` has database
  credentials — `check.yml` runs only the static `check:workflow-catalog`, and `supabase.yml`
  applies migrations through the Supabase CLI. Run them by hand against staging or production
  after a catalog change, or give the deploy workflow a connection string first.

## Cross-References

- `packages/harness/src/gates.ts` — `FLOOR_GATES` includes `@carbon/checks test` and `clobbers` as CI gates
- `packages/database/supabase/migrations/` — SQL files scanned by conformance checks
- `apps/erp/app/modules/` — module directories validated by `moduleShape`
