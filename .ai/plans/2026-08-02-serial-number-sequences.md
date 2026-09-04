# Serial Number Sequences — Implementation Plan

**Date:** 2026-08-02
**Branch:** malabo
**Status:** APPROVED — Option A (full v1: config + location code + batch + serial pre-split + MES rework). Smaller decisions accepted as recommended: table `itemSerialSequence`, Serial/Batch-only, `settings` permission, `assign-serial-numbers` edge fn, root-item scope, ISO `%{ww}`.

## Goal

Let users configure an optional serial-number **format + counter per item** (zero or one per
item), almost identical to the existing document **Sequences** feature, but keyed to an item
instead of a document type. When a job is created for that item, auto-generate serial numbers
from the format and assign them as the `readableId` of the job's tracked entities:

- **Batch** item → generate **1** number → the single `quantity=N` seed entity.
- **Serial** item, qty N → generate **N** numbers → **N** `quantity=1` entities (pre-split at creation).

Configured format segments (generalized from the customer's `[Site][Year][Month][serial]` /
`[Product family][Year][Week][serial]` examples):

- **Prefix** (static text; generalizes "site"/"product family") — supports tokens.
- **Date tokens**: `%{yyyy}` `%{yy}` `%{mm}` `%{dd}` and **NEW `%{ww}`** (week).
- **Location token NEW `%{location}`** → `location.code ?? location.name`.
- **Counter** with configurable zero-pad width (`size`) and `step`.
- **Suffix** (optional; same tokens).

Worked examples this must reproduce:
- `%{location}-%{yy}%{mm}` + size 5, location code `US`, 2026-07 → `US-260700001`
- `MOTH%{yy}%{ww}` + size 5, 2026 week 31 → `MOTH263100001`

## Key design decisions (NEED CONFIRMATION where flagged 🔶)

1. **Table `itemSerialSequence`**, PK `("id","companyId")` (modern convention) with a
   **UNIQUE `("itemId","companyId")`** to enforce one-per-item. Columns mirror `sequence`
   (`prefix`, `suffix`, `next` default 0 = none issued, `size` default 5, `step` default 1) +
   full audit columns. FK `itemId → item(id)`. 🔶 Name: `itemSerialSequence` (avoids collision
   with existing inventory `path.to.serialNumbers`).
2. **Only Serial/Batch items** may have a serial sequence (non-tracked items get no tracked
   entities, so nothing to number). Enforced in the item picker + item-page card visibility.
3. **Permission gating = `settings`** (view/create/update/delete), mirroring Sequences, since
   this is "a new sub-module in settings." The item-page card is also `settings`-gated. 🔶
   Alternative: gate on `parts`. Recommend `settings`.
4. **Generation lives in a new edge function `assign-serial-numbers`** invoked from `insertJob`
   after the job insert (Seam A). Atomic reservation via Kysely `UPDATE ... SET next = next +
   count*step ... RETURNING` inside the function's transaction. Interpolation (date + week +
   location) done in TS. No new Postgres RPC needed (settings/item previews compute in TS
   without incrementing).
5. **Serial pre-split at job creation** into N `quantity=1` Reserved entities. 🔶 **This is the
   scope-expanding decision** — it requires reworking 4 MES route heuristics (see Phase 5).
   Verified: no data/ledger double-creation downstream; `complete_job_to_inventory` iterates
   existing entities; `issue.jobOperationSerialComplete` spawn is self-guarding. The only breakage
   is MES "select newest Reserved entity" logic.
6. **Scope = root make method seed per job.** MTO sub-assemblies are separate jobs → each gets
   its own serials via the same hook. Non-root `jobMaterial` seeds are out of scope for v1.
7. **`%{ww}` = ISO week** (`getISOWeek`-style). Minor year-boundary caveat vs calendar `%{yy}`;
   acceptable, documented.

## Phases

### Phase 0 — Location `code` column
- Migration: `ALTER TABLE "location" ADD COLUMN IF NOT EXISTS "code" TEXT;` (nullable).
- Backfill (idempotent): `UPDATE "location" SET "code" = 'HQ' WHERE "name" = 'Headquarters' AND "code" IS NULL;`
- Redefine SELECT-* views over `location` so `code` flows through — **view list PENDING from
  location research agent** (finalize before writing the migration).
- Add `code` to `locationValidator` (models) + the location form UI (optional Input, label "Code",
  helper "Short abbreviation used in serial numbers, e.g. HQ, US").
- `generate:types`.

### Phase 1 — `itemSerialSequence` table
- Migration: table + composite PK + unique(itemId,companyId) + FKs + `companyId` index + 4 RLS
  policies gated on `settings_view/create/update/delete` (::text[] casts, simple names).
- No seed rows (user-created, unlike `sequence`).
- `generate:types`.

### Phase 2 — Interpolation (`%{ww}`, `%{location}`)
- Extend `interpolateSequenceDate` in BOTH `apps/erp/app/utils/string.ts` and
  `packages/database/supabase/functions/lib/utils.ts` to add `%{ww}` (additive, safe).
- New `interpolateSerialNumber(format, { location })` (edge lib) that runs date/week interpolation
  then replaces `%{location}` with `code ?? name`. Used by the edge function.
- Settings/item preview: show `%{location}` as a literal placeholder (no job context).

### Phase 3 — Settings sub-module (CRUD, mirror Webhooks not Sequences)
- Models: `itemSerialSequenceValidator` in `settings.models.ts`.
- Service in `settings.service.ts`: `getItemSerialSequences` (list, join item readableId/name),
  `getItemSerialSequence`, `getItemSerialSequenceByItem(itemId)`, `upsertItemSerialSequence`,
  `deleteItemSerialSequence`.
- Types: `ItemSerialSequence` derived type.
- Routes: `x+/settings+/serial-numbers.tsx` (list+Outlet), `.new.tsx`, `.$id.tsx`, `.delete.$id.tsx`.
- UI: `ItemSerialSequencesTable` + `ItemSerialSequenceForm` (mirror SequenceForm preview + token
  legend incl. `%{ww}` and `%{location}`; add item picker on New, disabled on edit).
- Nav entry in `useSettingsSubmodules.tsx` (System group, icon e.g. `LuBarcode`).
- Path helpers: `serialNumberSettings`, `newSerialNumberSetting`, `serialNumberSetting(id)`,
  `deleteSerialNumberSetting(id)`, `api.serialNumberSettingByItem(itemId)`.
- Item combobox source: only `itemTrackingType IN ('Serial','Batch')` items without an existing
  sequence.

### Phase 4 — Item-detail surface
- A card on the item detail page (part/material/tool/consumable) to add/edit/delete THIS item's
  serial sequence, reusing `ItemSerialSequenceForm` + service. Visible only when
  `itemTrackingType ∈ {Serial,Batch}`.
- Simplest home: extend `x+/part+/$itemId.details.tsx` (+ material/tool/consumable equivalents)
  action with an `intent` branch, render the card in the details stack. (Confirm exact host tab
  during execution.)

### Phase 5 — Job-creation integration + MES rework
- **Edge function `assign-serial-numbers`** (`config.toml` + `functions/assign-serial-numbers/index.ts`):
  - Validate `{ jobId, companyId, userId }`; `requirePermissions(update: production)`.
  - Kysely txn: load job (itemId, quantity, locationId), item (itemTrackingType),
    `itemSerialSequence` (none → return `{assigned:0}`), location (code,name).
  - Reserve `count` = (Batch ? 1 : round(job.quantity)) via `UPDATE ... RETURNING`.
  - Format the `count` numbers with date/week/location interpolation.
  - Batch: update the single seed entity's `readableId`.
  - Serial: transform the seed into entity #1 (quantity=1, readableId=serial1) + insert N-1 more
    (quantity=1, same attributes, Reserved) with the remaining serials.
- `insertJob` invokes `assign-serial-numbers` after the job insert (near the `recalculate` invoke).
- **MES rework (required by pre-split)** — migrate "newest Reserved entity" heuristics to "next
  entity without an `Operation ${operationId}` attribute" (the pattern already in
  `useOperation.tsx` / `postSerialCompletions`):
  1. `apps/mes/app/routes/x+/operation.$operationId.tsx` (loader `[length-1]` fallback + default id)
  2. `apps/mes/app/routes/x+/start.$operationId.tsx` (`[length-1]` fallback)
  3. `apps/mes/app/routes/x+/end.$operationId.tsx` (`[length-1]` fallback + `newTrackedEntityId` advance)
  4. `apps/mes/app/routes/x+/complete.tsx` (stop relying on `newTrackedEntityId`)
  - Optional cleanup: remove now-dead spawn block in `issue.jobOperationSerialComplete`; tighten
    its re-completion guard to skip entities already carrying `Operation ${id}`.

### Phase 6 — Verification
- `generate:types` (after Phases 0/1), scoped typechecks (erp, mes, database, functions), biome.
- Browser e2e (mandatory per project rule): configure a serial sequence for a serial item, create a
  job qty=3 → confirm 3 numbered "Serial 1..3" entities on Job Properties; batch item → 1 number;
  MES: complete units in order, confirm each advances and no re-completion.

## Progress (2026-08-02)

Implemented (lint-clean via Biome; NOT yet type-checked or browser-verified — pending stack boot):
- [x] Phase 0 — `location.code` migration + HQ backfill; validator/form/seed (`code`) added.
- [x] Phase 1 — `itemSerialSequence` table + RLS + `itemSerialSequences` list view.
- [x] Phase 2 — `%{ww}` added to both `interpolateSequenceDate`; `interpolateSerialNumber` (+`%{location}`) in edge lib.
- [x] Phase 3 — settings CRUD: validator, service (get/list/getByItem/upsert/delete), type, form+table UI,
      4 routes (list/new/$id/delete), nav entry, 4 path helpers (`serialNumberSequence*`), barrels.
- [x] Phase 5a — `assign-serial-numbers` edge fn + `config.toml`.
- [x] Phase 5b — `insertJob` + `convertSalesOrderLinesToJobs` both call shared `assignJobSerialNumbers`
      helper (guarded: only invokes when the item has a sequence). Deprecated `upsertJob` has no create callers.
- [x] Phase 5c — MES pre-split rework: shared `getNextIncompleteSerialEntity` helper +
      `isSerialEntityIncompleteForOperation` predicate; 4 routes advance #1→#N; old lazy-split flow preserved.
- [x] Phase 6a — stack booted (freed 4 slots), **migrations applied cleanly**, types regenerated,
      `erp` + `mes` + `@carbon/database` typecheck GREEN, Biome GREEN. (Fixed nullable-view-column
      handling in the table + new/$id routes.)
- [~] Phase 6b — browser e2e (configure sequence → create serial job qty 3 → verify SN-00001/2/3) running.
- [ ] Commit + PR (with screenshots) — only on the user's ok (no auto-commit).

Design note: settings sub-module is full CRUD with an Item picker in New (blacklisting already-configured
items to enforce one-per-item); no per-item-page card in v1 (any item type is configurable from settings).

## Risks / open questions
- 🔶 Serial pre-split + MES rework in v1 vs. ship config + Batch first, defer Serial. (Serial can't
  ship without the MES fixes — they're a unit.)
- Job quantity is `NUMERIC(10,4)`; serial jobs assumed integer — round + guard.
- Concurrency: two jobs for the same item created simultaneously — the atomic `UPDATE...RETURNING`
  reservation prevents duplicate serials.
- Existing jobs created before a sequence exists are unaffected (readableId stays null; manual entry
  still works via Job Properties).

## Files touched (estimate)
~3 migrations, 1 edge function (+config.toml), settings module (models/service/types/4 routes/2 UI
+ nav + path helpers), items module (card + service + validator, ×4 item types), production
`insertJob`, 4 MES routes, location validator + form, 2 interpolation utils. Cross-module → approval
required per AGENTS.md.
