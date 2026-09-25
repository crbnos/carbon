# Demo-data validation gate — current state and gaps (research, 2026-09-22)

Source: Explore agent over `.husky/pre-commit`, `packages/database/src/check-datasets.ts`, `packages/database/src/datasets/verify.ts`, `sql.ts`, tiers.

## 1. The pre-commit trigger and failure behavior

`.husky/pre-commit:46-58`:

```sh
if [ -z "$CARBON_SKIP_DATASET_CHECK" ] && git diff --cached --name-only | grep -q '^packages/database/'; then
    echo "Checking demo datasets against the schema..."
    if ! pnpm --silent db:check:datasets; then
        echo ""
        echo "Commit blocked by the demo-dataset check. The reason is printed above."
        echo "Skip it with: CARBON_SKIP_DATASET_CHECK=1 git commit ..."
        exit 1
    fi
fi
```

- **Trigger:** any staged path under `^packages/database/` (whole package, not just datasets). Changes outside `packages/database/` that break seeding do NOT trigger it.
- **Blocks:** yes — real failure sets `process.exitCode = 1` (`check-datasets.ts:127`), hook exits 1 with a clear message. Script prints per-dataset `✗ <key> (Ns) — <error>` (`check-datasets.ts:120`) plus "N migrations behind" hint or "fix them in packages/database/src/datasets/…" (`check-datasets.ts:112-124`).
- **Bypasses:** `CARBON_SKIP_DATASET_CHECK=1`, `git commit --no-verify`, and husky missing (`.husky/pre-commit:5-8` exits 0 on fresh clone before pnpm install).
- Scripts: root `package.json:47` → `pnpm --filter @carbon/database db:check:datasets --` → `tsx src/check-datasets.ts`. Backup check hook block (`.husky/pre-commit:60-71`) triggers narrower: only `^packages/database/supabase/migrations/`.

## 2. What verify.ts validates

Apply-only, always-rollback (`verify.ts:64-107`): BEGIN → `SET LOCAL app.sync_in_progress` → `seedCompanyReferenceData` → `applyDatasetTiers` → ROLLBACK in `finally`. Failures returned per dataset, not thrown, so one broken dataset doesn't mask others.

Proves: every INSERT accepted by live schema. `buildInsert` reads `information_schema` and throws named errors for unknown table/column (`sql.ts:34-79`). FK/NOT NULL/CHECK/enum/unique violations surface as raw Postgres errors (`verify.ts:96-100`). `assertSingle` catches specific duplicate rows.

Does NOT check: row counts (a tier inserting 0 rows passes), referential completeness beyond Postgres FKs, wipeFirst/re-apply, business invariants.

## 3. Gap surface

| Failure mode | Caught? | Where |
|---|---|---|
| Dropped/renamed column | Yes, if DB current | `sql.ts:75-77` |
| FK / NOT NULL / CHECK / unique violation | Yes, raw PG error | `verify.ts:96-100` |
| Wrong ref key in most tiers | Yes — `need()` throws (`sql.ts:180-186`) | 01:17 uses, 05:14, 04:11, 06:8, 03:7, 02:5, 07:2, 08:2, 12:1 |
| Wrong ref key in 12-planning / 09-accounting | **No** — logs + continue | `12-planning.ts:40,60,178`; `09-accounting.ts:22,75` (and 09/10/11 have **zero** `need()` calls) |
| Wrong `cloc:`/location/shelf-parent key | **No** — `?? null` / unguarded fallback | `04-sales.ts:61,320`; `09-accounting.ts:84`; `01-foundation.ts:131,175`; `12-planning.ts:84` |
| Bad `componentNodeIds` vs graph.json | **No** — graph never read by check | `types.ts` AssemblyStepSpec |
| Wrong quantities/prices/dates/totals; shipment > order qty; invoice subtotal ≠ lines | **No** — no invariant checks | — |
| Row-count regression (silent 0-row tier) | **No** | `verify.ts` |
| promisedDateOffset outside 48-week horizon | **No** — `if (!periodId) break;` | `12-planning.ts:186-187` |
| Migration written but not applied | **No** — reads live schema | `sql.ts:29-32` |
| DB down / no users | **No** — warn + exit 0 (`skip()`) | `check-datasets.ts:42-45,100-111` |
| Ref keys at typecheck | **No** — all bare `string`; `SeedRefs` is `Record<string,string>` | `types.ts` |

Also: `ctx.log` skip messages are invisible in the pre-commit run — `check-datasets.ts` never passes a `log` callback to `verifyDataset`. No tests exist under `src/datasets/`. Typecheck is not run by the hook (lint-staged runs biome only, `package.json:27-34`).

Silent-skip / silent-null sites (full list):
- `12-planning.ts:40-44,60-64,178-182` — missing item ref → skip itemPlanning / demand projection
- `09-accounting.ts:22-23` — no GL accounts → skip journal block; `:75-78` missing fixedAssetClass → skip asset; `:84` wrong location → falls back to HQ
- `04-sales.ts:61,320` — `cloc:` key `?? null` (SO with null customer location)
- `01-foundation.ts:131` — bad shelf parent → root shelf; `:175` unguarded workCenter ref
- `06-production.ts:17` (`!industryId` → whole assembly skipped), `:35` (optional-chained item), `:237` (`!operationId` → genealogy skipped)
- `03-inventory.ts:7`, `04-sales.ts:29`, `12-planning.ts:30` — `refs.locations.Plant ?? locationId`

Typed unions that DO exist: `DatasetKey`, `ChangeType`, `ProcedureStepSpec.type`, `FixedAssetSpec` fields, `JournalLineSpec.accountClass`, `JournalEntrySpec.status`, `BomLineEditSpec`, `PurchaseOrderSpec` discriminants, `ItemType`. Dataset shape itself is a compile error if malformed.
