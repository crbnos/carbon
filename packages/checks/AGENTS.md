# @carbon/checks

Conformance checking, clobber detection, invariant queries, and module structure validation for the Carbon monorepo.

## Always

- **Run checks against real migrations and module directories** — `collectFindings(root)` scans both SQL migrations and app module structure
- **Use `newViolations()` for CI** — filters findings against the baseline so only new violations fail the build
- **Add new conformance rules to the array that matches the rule's SOURCE** — `CONFORMANCE_CHECKS` (SQL migrations), `SERVER_CHECKS` (server-only TS), `TS_CHECKS` (all app + shared-package TS, client and server), `EDGE_FUNCTION_CHECKS` (one source per edge function, all of its `.ts` files joined — `sources/edge-functions.ts`), or `STRUCTURE_CHECKS` (module layout). Follow the `ConformanceCheck` / `StructureCheck` interface
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

- **Conformance checks**: `noNumericPrecision`, `noLegacyRls`, `noDerivedPercentColumn` — scan SQL migrations for anti-patterns (`noDerivedPercentColumn` flags a `*Percent`/`*Rate` column `GENERATED ALWAYS AS` an expression that divides — a percentage is an entered fact, never a lossy echo of a rounded amount); `noLocalTimezone` (in `SERVER_CHECKS`) scans server TS (`sources/server-files.ts`) for `getLocalTimeZone()`, UTC day-slicing, local date-parts of now (`new Date().getDay()` etc.), and `setHours(0,0,0,0)` midnights. Scanned files: MES services, `packages/jobs`, edge functions, ERP module `.service.ts`/`.server.ts`, **plus both apps' route trees** — route modules are server AND client in one file, so `maskClientCode` blanks the browser half (default export, `clientLoader`/`clientAction`, PascalCase/`use*` declarations) while keeping loaders, actions, and the module-level helpers they call
- **Numeric-precision checks** (in `TS_CHECKS`, over `sources/typescript.ts`): `noRawRounding` flags `Math.round/ceil/floor` and `.toFixed` on value-bearing numbers (use `round`/`scrapAllowance`/`applyRate`/`deriveRate` from `@carbon/utils`); `noInlineFractionDigits` flags `minimum`/`maximumFractionDigits` at a call site (pick a named kind from `@carbon/utils` `format.ts`, and `INPUT_FORMAT.*` for anything editable); `noUnroundedTrackedQuantity` flags inline unrounded arithmetic inside a `.updateTable("trackedEntity")` statement's `quantity:` set, and a raw `===`/`!==`/`<` compare against a `*[Ee]ntity*.quantity` read (use `round`/`settleQuantity` at the write, `isFullDraw` at a split gate — see `.claude/rules/traceability-model.md`). It is scoped to what one file can prove: a `quantity:` set from an already-rounded variable is unflaggable either way, and a compare of two locals is presumed rounded where they were defined. It has **no baseline entries** — the whole tree was fixed in the pass that added it, so any finding is new. `sources/typescript.ts` walks `apps/erp/app/{components,hooks,modules,routes}`, `apps/mes/app`, `packages/database/supabase/functions`, `packages/{ee,jobs}/src`, `packages/documents/src/{pdf,utils}` and the shared packages `packages/{utils,form,react,printing,workflows}/src` — tests and the image/logo resizers excluded. The shared packages matter: `@carbon/utils` is where the standard's own helpers live, and `form`/`react` own the number inputs whose `formatOptions` are part of the storage round-trip. See `.claude/rules/numeric-precision.md`
- **Edge-function auth** (`EDGE_FUNCTION_CHECKS`): `edgeFunctionAuthorizesCaller` fails any function under `packages/database/supabase/functions/` that never calls `requirePermissions` / `requireCaller` / `requireServiceRole` / `getSupabaseServiceRole`, because `verify_jwt` accepts the published anon key. `ALLOWED` in the check holds the functions that are correct without one, each with its reason (`logo-resizer`, `transcription`). `embed`, `event-wake` and `trigger` are baselined, not allowed: Postgres calls them over pg_net with the anon key from `config`, so gating them needs a migration that makes Postgres send a server credential first
- **Structure checks**: `moduleShape` — validates ERP modules have `types.ts`, `ui/`, `index.ts`, `<name>.service.ts`, `<name>.models.ts`
- **Clobber detection**: `findClobbers(branch, main)` — identifies DB objects redefined on both sides
- **Baseline**: `src/baseline.ts` — grandfathered violations keyed by `checkId + file + line + snippet`
- **Invariants**: SQL queries loaded from directory, injected `Query` for testability
- **`tracked-entity-zero-available.sql`**: a lot whose quantity is gone must be `Consumed`, never a live status. `Scrapped`/`Rejected` are excluded — both are quality markers kept as historical record and already excluded from on-hand. Enforcement of the drain rule is per-writer, so this is the net that catches husks from ANY source: rows predating the rule, and any writer that revives a drained lot (unconsume, shipment void, disposition Use As Is / Rework). Run it before deciding whether to promote the rule to a DB CHECK
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
