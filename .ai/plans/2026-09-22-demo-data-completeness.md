# Demo Data Completeness — implementation plan

**Spec / source:** `.ai/specs/2026-09-22-demo-data-completeness.md`
**Branch:** `feat/demo-data-completeness`
**Research:** `.ai/research/2026-09-22-demo-data-current-coverage.md` (what exists), `.ai/research/2026-09-22-app-feature-surface.md` (what must be covered), `.ai/research/2026-09-22-demo-data-validation-gate.md` (validation holes)

**Plan-time corrections to the spec** (verified against `packages/database/src/types.ts` on this branch):
- Inspection engine tables are `inspection`, `inspectionSample`, `inspectionMeasurement`, `inspectionSamplingPlan` (not "inboundInspection"/"itemSamplingPlan").
- Change-order tasks table is `changeOrderActionTask`.
- These tables DO NOT exist and are dropped from scope: `crew`, `equipment`, `customerPortal`, `receiptLineTracking`, `batchNumber`, `serialNumber`, `nonConformanceInvestigationTask`. Tracked-entity rows ARE the lot/serial registry.
- All other target tables verified present (pickingList, stockTransfer, warehouseTransfer, salesReturnOrder, purchaseReturnOrder, qualityDocument, gauge(+CalibrationRecord), riskRegister, maintenanceSchedule/Dispatch, training(+Question/Assignment), timeCardEntry, holiday, employeeAbility/Shift, payment, invoiceSettlement, memo, exchangeRate, accountingPeriod, periodCloseTask, fixedAssetDisposal, workflowRun/StepRun, jobOperationBatch/Note, itemSupersession, material* taxonomy, rework, note, tag, project, dimensionValue, *StatusHistory, jobFavorite, itemShelfLife, suggestion, quoteMakeMethod, customerItemPriceOverride, pricingRule, configurationParameter, customerPartToItem, nonConformance{ActionTask,ApprovalTask,Reviewer,Supplier,Customer,SalesOrderLine,PurchaseOrderLine,TrackedEntity,Inspection}).

## Ground rules for every task (read once, apply always)

1. Working dir `/Users/aashu/work/carbon/carbon`. Never `npm`; always `pnpm`. **Never commit** — the user commits.
2. Engine idiom: tiers use `insertRow`/`insertId`/`insertMaybe` from `datasets/sql.ts` (auto-fills `companyId`, `createdBy`; validates columns against live `information_schema` at runtime and throws on unknown table/column). Cross-refs resolve via `need(ctx.refs.X, key)`. Dates ONLY via `DayOffset` + `resolveDate`/`resolveTimestamp` (`datasets/dates.ts`); never JS `Date`, never `CURRENT_DATE`.
3. Before inserting into any table for the first time, read its Insert type in `packages/database/src/types.ts` (search `      <table>: {` then the `Insert:` block) — do not guess columns. Nullable FKs may be omitted; NOT NULL columns must be supplied.
4. Sync interceptors run during seeding — before adding an insert, check whether an interceptor already creates the row (pattern: tier 2's itemCost UPDATE, tier 6's jobMakeMethod adopt). If a unique violation appears, adopt-and-UPDATE instead of insert.
5. The verification loop after every cluster:
   ```bash
   pnpm --filter @carbon/database typecheck        # tsgo --noEmit
   pnpm --silent db:check:datasets                  # must print ✓ for all four (~3s)
   ```
   Fix until green before the next cluster. A `Seed:`-prefixed error names the bad ref; a raw PG error names the constraint.
6. All four data packs move together per cluster: new Dataset fields are REQUIRED (compile enforces parity). `data/satellite/` is authored first as the canonical pattern; robotics/precision/motor mirror it with industry-appropriate content (same shape/volume, different story).
7. Story voice: each industry keeps its narrative (satellite manufacturer, robotics OEM, machine shop, motor assembler). Names/quantities/prices must be plausible for that industry; date offsets relative and internally ordered (order < ship < invoice, etc.).
8. Ledger invariant: any hand-authored `itemLedger` consumption/shipment must be covered by opening stock or seeded receipts for that (item, shelf); journals must balance per entry.
9. If an assumption in a task turns out false (missing column, interceptor conflict that can't be adopted, table shape incompatible), re-decide via the ship-it resolution ladder, record the change in the spec's Autonomous Decisions section, and continue. Improvising silently is forbidden; so is silently dropping coverage.

## Progress

- [x] Task 1: Loud refs — silent skips become throws (kept `.Plant ?? locationId` fallbacks: tier 01 sets `refs.locations.Plant` unconditionally, so they are dead-safe; shelf-parent guard already existed)
- [x] Task 2: Pure dataset validator + pre-DB wiring + vitest (drill passed: broken ref + DB down → exit 1 with named violation; genealogy-input check corrected to uniqueness — tier 06 creates those entities itself)
- [x] Task 3: Cluster C1 — foundation & parties depth (supplier status is the `supplierStatus` enum column; tag has no color column so TagSpec is `{name, table}`; holiday.year is GENERATED — never inserted; EUR ships in bootstrap's full ISO currency set so no tier currency insert; EUR-supplier-per-dataset made a validator convention)
- [x] Task 4: Cluster C2 — items depth (verified: typecheck ✓, 18 vitest ✓, db:check ✓×4; one Consume First supersession pair per dataset, customer parts, price overrides, pricing rules, config params, material classification, revision ladders, Timestamp/File/Inspection procedure steps, method op tools+parameters)
- [x] Task 5: Cluster C3 — inventory states (verified: typecheck ✓, 20 vitest ✓, db:check ✓×4; counts Draft+Posted w/ variance ledger, On Hold/Rejected lots, shelf life + expiring lot, Make/Transfer kanbans, stock+warehouse transfers ×3 statuses w/ ledger pairs)
- [x] Task 6: Cluster C4 — sales matrix, RMA, fulfillment lifecycle (verified: typecheck ✓, 22 vitest ✓, db:check ✓×4; full RFQ/quote/SO status matrix incl. No Quote + reasons, posted/partial/voided shipments w/ Sale ledger, invoice lifecycle keyed for C9 settlement, RMAs ×3 statuses, status history, favorites; validator now pins required-status sets)
- [x] Task 7: Cluster C5 — purchasing matrix, returns, OSP, FX (verified: typecheck ✓, 24 vitest ✓, db:check ✓×4; full PO matrix + OSP + EUR PO, posted/partial/voided receipts w/ Purchase ledger + minted batch lots, invoice lifecycle keyed for C9, purchase returns ×3, standalone supplier quotes Draft/Expired/Declined, PO status history)
- [x] Task 8: Cluster C6 — production depth + picking (verified: typecheck ✓, 26 vitest ✓, db:check ✓×4; deadline types, op-status overrides unlocking In Progress/Waiting, Scrap/Rework quantities, op notes, open MES event, picking lists In Progress/Completed w/ ledger; quote-method fill deferred per Decision 9)
- [x] Task 9: Cluster C7 — quality depth (verified: typecheck ✓, 29 vitest ✓, db:check ✓×4; NCRs Registered/In Progress/Closed × all priorities × both sources w/ required-action tasks, MRB approval + Engineering/Quality reviewers, supplier/PO-line/customer/SO-line/lot/inspection links; file-less inspection plan → Partial receipt lot w/ per-feature sampling plans, derived samples + measurements, history; quality docs Draft/Active/Archived; gauges Pending/In/Out-of-Calibration; 5 risks all statuses/sources)
- [x] Task 10: Cluster C8 — change-order lifecycle (verified with Task 9; Start/Engineering Complete/Cancelled notices, item-free, typed + prioritized, NCR-linked, action tasks covering all 4 task statuses)
- [x] Task 11: Cluster C9 — accounting depth (verified: typecheck ✓, 34 vitest ✓, db:check ✓×4; 5 journals incl. Reversed pair + dimension tags, 12 periods Closed/Locked/Open + close tasks, 6 payments + settlements (views probe-verified Paid/Partially Paid/credited), 2 memos, 2 projects, EUR override (global exchangeRate deliberately untouched), Disposed + Units of Production assets; see spec Decision 13)
- [x] Task 12: Cluster C10 — ops slice (maintenance/HR/training) + workflow runs (verified: typecheck ✓, 38 vitest ✓, db:check ✓×4; 5 schedules, 5 dispatches ×5 statuses w/ Maintenance Consumption spare-part issue, 3 trainings (5 question types, Completed+Pending), 6 timecards, 2 suggestions, 2 person notes, 3 runs Succeeded/Failed/Skipped; see spec Decision 14)
- [x] Task 13: Row-count floors in verify.ts (verified: 213 measured floors in datasets/coverage.ts — min across datasets, volume ×0.8; dimension* scoped by companyGroup, favorites via parent, period skipped; one UNION ALL before ROLLBACK; drill pickingList 2→3 + jobFavorite 1→2 → ✗ naming both, exit 1, reverted; see spec Decision 15)
- [x] Task 14: Full verification — seed, audit matrix, re-apply, baselines (verified: audit 264 present / 103 absent all classified, 3 §B gaps fixed ×4 datasets — lifecycle RFQs, Scrapped lot, Production/Prototype revisions; re-apply was broken by posted invoices/settlements/payments + leaked org groups → wipe fixed; sat→rob→sat both 229/231 tables = clean apply; 4 baselines + structural (no methodMaterial/methodOperation decrease, journals balance); drills: DB-down ✗ exit 1, hook "Commit blocked" exit 1; typecheck ✓, 43 vitest ✓, db:check ✓×4, jobs typecheck ✓, biome 0 errors)
- [x] Task 15: Docs — rule file + datasets AGENTS.md + spec appendix (verified: db:check ✓×4 in 3.6s, 43 vitest ✓, typecheck ✓; also packages/database/AGENTS.md, workflow-run-history rule `completedAt` fix, demo-data.mdx + regenerated agent KB; spec Status → Implemented with evidence-ticked acceptance criteria)

## Dependencies

Task 1 → Task 2 → Tasks 3–12 strictly in order (each cluster leaves the tree green; later clusters reference earlier refs). Task 13 after 12. Task 14 after 13. Task 15 after 14. Within each cluster task, the three mirror-industry authoring subtasks are parallel.

---

## Task 1: Loud refs — silent skips become throws

**Depends on:** none
**Files:**
- Modify: `packages/database/src/datasets/tiers/12-planning.ts` — lines ~40-44, ~60-64, ~178-182: replace `if (!item) { ctx.log(...); continue; }` with `need(ctx.refs.items, readableId)`-style resolution; line ~84 `?? null` for the demand order's `cloc:` key → `need`.
- Modify: `packages/database/src/datasets/tiers/09-accounting.ts` — line ~75-78 missing fixedAssetClass → throw with a named error; line ~22-23 "no GL accounts" → throw; line ~84 `ctx.refs.locations[spec.location] ?? ctx.locationId` → `need(ctx.refs.locations, spec.location)`.
- Modify: `packages/database/src/datasets/tiers/04-sales.ts` — lines ~61 and ~320 `ctx.refs.misc[`cloc:${spec.customer}`] ?? null` → `need`.
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` — line ~131 unguarded shelf parent → `need(ctx.refs.shelves, shelf.parent)` when `shelf.parent` is set; line ~175 unguarded work-center ref → `need`.
- Leave alone: `refs.locations.Plant ?? locationId` in 03/04/12 ONLY if some dataset legitimately lacks a Plant — check all four `foundation.ts`; all four define a plant, so convert to `need(ctx.refs.locations, "Plant")` via a shared helper `plantLocation(ctx)` if the key name varies per dataset, use the dataset's own plant name. If a dataset names its plant differently, resolve by the foundation's `plant.name`.
- Modify: `packages/database/src/check-datasets.ts` — pass a `log` callback through to `verifyDataset` that buffers tier logs and prints them ONLY on failure (so remaining legitimate `ctx.log` diagnostics are visible when something breaks).

**Steps:**
1. Read `packages/database/src/datasets/sql.ts` `need()` (~line 180) for the exact error shape.
2. Make each replacement above. Where the value feeds a nullable column that the spec may legitimately omit (optional field on the spec type), keep optionality — the throw is only for keys that are PRESENT but unresolvable.
3. Run the loop.

**Verify:**
```bash
pnpm --filter @carbon/database typecheck && pnpm --silent db:check:datasets
# Expected: ✓ satellite ✓ robotics ✓ precision ✓ motor (current data is valid, so throws change nothing)
```

**Out of scope:** any data file changes; `06-production.ts` `if (!industryId) return` (a null industryId is a legitimate dataset state).

## Task 2: Pure dataset validator + pre-DB wiring + vitest

**Depends on:** Task 1
**Files:**
- Create: `packages/database/src/datasets/validate.ts`
- Create: `packages/database/src/datasets/validate.test.ts`
- Modify: `packages/database/src/check-datasets.ts` — run the validator for all selected datasets BEFORE `pool.connect()`; on failure print each `✗ <dataset>: <message>` and `process.exitCode = 1` and return (never reach `skip()`).

**Steps:**
1. `export function validateDataset(dataset: Dataset): string[]` returning human-readable violations (empty = valid). Build ref indexes from the dataset itself (item readableIds across all six buckets + change-order-minted revisions; customer names; supplier names; process names; work-center names; shelf names; warehouse names; job keys; opportunity/SO keys). Checks, each with a precise message naming the slice + key:
   - every slice non-empty (arrays length > 0 where the rule doc requires it);
   - every cross-ref string resolves (BOM components, BOP processes/work centers/supplier processes, opening-stock shelves, sales/planning item+customer refs, purchasing supplier refs, job item/SO/customer refs, NCR item/job refs, change-order item refs, kanban/supersession/shelf-life refs, ops-slice refs — extend this list as later tasks add fields);
   - `rfqQuotes[].lines[].prices.length === rfqQuantityBreaks.length`;
   - every `JournalEntrySpec` balances (Σdebit = Σcredit) at 2dp;
   - `promisedDateOffset` values within 0–336 days (48-week horizon);
   - assembly `componentNodeIds` ⊆ node ids of the bundled `assets/<industryId>/models/<name>.graph.json` (resolve via the same glob as `assets.ts`; skip when `industryId` null);
   - net on-hand per (item) never negative: Σ(openingStock + posted receipt quantities) − Σ(posted shipment/pick/consumption quantities authored in data) ≥ 0 — implement against the fields that exist at the time, extend in later tasks;
   - supersession pairs reference two distinct existing items.
2. `validate.test.ts`: `for (const key of datasetKeys) expect(validateDataset(getDataset(key))).toEqual([])`, plus 2–3 negative cases on a hand-built minimal invalid dataset fragment (bad item ref, unbalanced journal) asserting the message text.
3. Wire into `check-datasets.ts` before any DB work, with block message: `The demo datasets are internally inconsistent. Fix them in packages/database/src/datasets/data/ before committing.`
4. Loop.

**Verify:**
```bash
pnpm --filter @carbon/database typecheck && pnpm --filter @carbon/database test && pnpm --silent db:check:datasets
# Expected: vitest green incl. validate.test.ts; ✓ all four datasets
# Then: temporarily break one BOM ref in data/motor/items.ts, run `pnpm --silent db:check:datasets` with the DB STOPPED-equivalent (unset SUPABASE_DB_URL) — expect exit 1 + named violation; revert the break.
```

**Out of scope:** row-count floors (Task 13); DB-layer skip behavior (stays).

## Tasks 3–12: cluster mechanics (applies to every cluster below)

Each cluster task = five subtasks:
1. **Types:** extend `datasets/types.ts` with the cluster's new REQUIRED fields/specs (JSDoc every ref field with what it resolves against, matching existing style).
2. **Engine:** extend the named tier(s). New refs bucket entries go in `ctx.refs` (extend `SeedRefs` if a new bucket is needed).
3. **Satellite data:** author `data/satellite/<slice>.ts` additions (canonical pattern).
4. **Mirror ×3 (parallel subagents):** robotics, precision, motor — same shape/volume, industry-appropriate story. Subagent prompt must include: the cluster's types diff, the satellite file as exemplar, ground rules 2/3/7/8, and the verify loop.
5. **Validator:** extend `validate.ts` + its test for the new ref fields; run the full loop (`typecheck`, `test`, `db:check:datasets`).

## Task 3: Cluster C1 — foundation & parties depth

**Depends on:** Task 2
**Files:** `datasets/types.ts`, `tiers/01-foundation.ts`, `data/*/foundation.ts`, `validate.ts`
**New capabilities (FoundationData):**
- `CustomerSpec`/`SupplierSpec` gain optional `currencyCode` (default "USD"; tier passes through — currency rows for USD/EUR exist from bootstrap, verify `currency` table contents in tier via lookup and throw if code unknown) and optional `paymentTerm` (name matched against bootstrap `paymentTerm` rows via ILIKE-free exact fetch of all terms into `ctx.refs.misc`).
- `SupplierSpec.status` optional `"Active" | "Inactive" | "Pending" | "Rejected"` → `supplier.supplierStatusId`? — READ the `supplier` Insert type first: status is via `supplierStatusType` enum column or a status table; implement per actual schema (escape hatch rule 9 if neither).
- `holidays: { name: string; dateOffset: DayOffset }[]` → `holiday` (companyId-scoped; read Insert type for year/date columns).
- `employeeLinks` (fixed behavior, no per-dataset data): tier links `ctx.userId` to the first 2 abilities (`employeeAbility`) and first shift (`employeeShift`).
- `materialTaxonomy`: seed `materialType`/`materialForm`/`materialSubstance`/`materialGrade`/`materialFinish`/`materialDimension` rows (READ Insert types; some are companyId-scoped with defaults from migrations — only seed what bootstrap doesn't, check for existing rows first with `insertMaybe`), and `MaterialItemSpec` in C2 will reference them.
- `tags: { name: string; color?: string }[]` → `tag` table (read Insert type for `table`/scope column).
**Data volume per dataset:** ≥2 holidays, ≥4 tags, 1 supplier per non-Active status (3 new suppliers), 1 EUR-currency supplier (reuse one of them or add), taxonomy rows apt for the industry (≥1 per taxonomy table).
**Verify:** the standard loop.
**Out of scope:** exchangeRate rows (C9); material item classification (C2).

## Task 4: Cluster C2 — items depth

**Depends on:** Task 3
**Files:** `datasets/types.ts`, `tiers/02-items.ts`, `datasets/helpers/items.ts`, `data/*/items.ts`, `validate.ts`
**New capabilities (ItemsData):**
- `supersessions: { predecessor: string; successor: string; mode: SupersessionMode; conversionFactor?: number; successorEffectivityOffset?: DayOffset; discontinuationOffset?: DayOffset }[]` → `itemSupersession` (PK itemId alone). One per dataset: a phased-out buy part with stock → its successor (Consume First).
- `customerParts: { item: string; customer: string; customerPartId: string; customerRevision?: string }[]` → `customerPartToItem`.
- `priceOverrides` → `customerItemPriceOverride` (+`customerItemPriceOverrideBreak` if the table pair exists — read types; else single-row).
- `pricingRules` → `pricingRule` (one Discount percentage rule for a customer).
- `configurable`: ONE make item per dataset gets `configurationParameterGroup` + 2–3 `configurationParameter` rows (one numeric, one list, one boolean) — display-only depth; NO configurationRule (rules engine risk).
- `MaterialSpec` items gain taxonomy refs (`materialFormId` etc. per Insert type of `material` extension table) resolving against C1 rows.
- `revisionLadder`: ONE part per dataset seeded with revisions across `itemRevisionStatus` values: existing active revision stays Production-equivalent; add a prior Obsolete revision and a Design/Prototype next revision via `createItem` with distinct `revision` strings — READ how `item.active`/`revisionStatus`? column is named in `item` Insert type first (revision status may be `status` on item or separate; implement per schema, escape hatch otherwise).
- Procedure step types: extend `ProcedureStepSpec.type` union with the remaining app-supported types (`File`, `Inspection`, `Task` already?) — compare against DB enum `procedureStepType` and add all values that need no file payload; add ≥1 new-typed step to one procedure per dataset.
- Method op depth: `BopOperationSpec` gains optional `tools: { description: string; quantity: number }[]` and `parameters: { key: string; value: string }[]` → `methodOperationTool`/`methodOperationParameter` (read Insert types; `methodOperationTool` may require a `tool` item id — if so, reference a seeded Tool item).
**Verify:** standard loop.
**Out of scope:** quote methods (C6); BOM restructuring of existing items (keep structural sums stable where possible — additions only).

## Task 5: Cluster C3 — inventory states

**Depends on:** Task 4
**Files:** `datasets/types.ts`, `tiers/03-inventory.ts`, `data/*/inventory.ts`, `validate.ts`
**New capabilities (InventoryData):**
- `inventoryCounts` becomes an array (replaces single `inventoryCount`): keep one Draft; add one **Posted** count with authorable lines `{ item: string; shelf: string; countedQuantity: number }`; for the posted count the tier writes the count + lines + one `itemLedger` `"Positive Adjmt."`/`"Negative Adjmt."` row per non-zero variance (documentType `"Inventory Count"` — confirm enum value in `itemLedgerDocumentType`).
- `trackedStates`: extend `OnHandTrackedSpec` with optional `status` (`Available | On Hold | Rejected | Scrapped`) and optional `expiryOffset: DayOffset`; expiry writes `trackedEntity` attribute or `itemShelfLife`? — READ `itemShelfLife` + `trackedEntity` Insert types; seed `itemShelfLife` on one batch-tracked item (mode `Fixed Duration`) AND stamp expiry on its lots per the traceability model (check `.claude/rules/traceability-model.md` for where expiry lives). Scrapped lot pairs with a `"Scrap"` `itemLedger` row (quantity out) + `productionQuantity`? NO — a standalone scrapped lot only needs the entity status + ledger `Negative Adjmt.` with `Scrap` documentType if the enum allows; keep consistent with validator on-hand math.
- `kanbans`: add `replenishmentSystem` authorable (`Buy | Make | Transfer`); Make kanban references a make item + work-cell-free fields per Insert type; Transfer kanban needs source shelf/location fields per Insert type.
- `stockTransfers`: `{ key; status: "Draft" | "Released" | "Completed"; fromShelf; toShelf; lines: { item; quantity }[] }` → `stockTransfer`+`stockTransferLine`; Completed also writes paired `"Transfer"` itemLedger rows (out/in).
- `warehouseTransfers`: `{ key; status: "Draft" | "To Ship" | "Completed"; fromLocation; toLocation; lines }` → `warehouseTransfer`+`warehouseTransferLine`; Completed writes ledger pairs.
**Data volume:** 2 counts, ≥2 non-Available tracked entities + 1 expiring lot, 3 kanbans (one per system), 3 stock transfers (one per status), 3 warehouse transfers.
**Verify:** standard loop.
**Out of scope:** pickingList (C6 — needs jobs).

## Task 6: Cluster C4 — sales matrix, RMA, fulfillment lifecycle

**Depends on:** Task 5
**Files:** `datasets/types.ts`, `tiers/04-sales.ts`, `data/*/sales.ts`, `validate.ts`
**New capabilities (SalesData):**
- Opportunities extended so the status matrix lands (spec §B): add specs producing quote statuses Draft/Partial/Lost(+`noQuoteReason` + line status `No Quote`)/Cancelled/Expired; RFQ Draft/Closed; SO Needs Approval/To Invoice/Invoiced. Reuse existing spec fields where possible (statuses are already free strings validated by enum at insert).
- `quoteLine` fields: allow authorable line `status` variety (Not Started/In Progress) — already authorable; use it.
- Shipments: `ShipmentSpec` gains `postedOffset?: DayOffset` + per-line `shippedQuantity` already exists; tier change: when status `"Posted"`, set `postingDate`, write per-line `itemLedger` rows (`entryType: "Sale"`, documentType `"Sales Shipment"`, negative quantity, from the line's item default shelf) and set line `shippedQuantity`; support a partial posted shipment (shipped < ordered) and a `"Voided"` one (no ledger).
- Sales invoices: multiple specs with statuses Draft/Submitted/Overdue/Paid/Partially Paid/Voided/Credit Note Issued (payment + settlement rows come in C9 referencing these by key — add `key` to `SalesInvoiceSpec` and register in `ctx.refs.misc` as `sinv:<key>`).
- `salesReturnOrders`: `{ key; status: "Draft" | "To Receive" | "Completed"; customer; returnReason; lines: { item; quantity; salesOrderKey? }[] }` → `salesReturnOrder`+`salesReturnOrderLine` (+credit line table if NOT NULL-required; read types). Completed return writes a `"Positive Adjmt."`-family ledger row per line (documentType from `itemLedgerDocumentType` — use the sales-return value present in the enum).
- `statusHistory`: tier writes 2–3 `salesOrderStatusHistory` rows for one order (Draft→Confirmed→In Progress with staggered `createdAt` timestamps via `resolveTimestamp`).
- `favorites`: tier stars 1 job/quote/SO for `ctx.userId` (`jobFavorite`, `quoteFavorite`, `salesOrderFavorite`).
**Verify:** standard loop + spot query in the run log:
```bash
psql postgresql://postgres:postgres@localhost:57312/postgres -c 'SELECT DISTINCT status FROM "quote"' # via a check-datasets debug run is NOT possible (rollback); rely on Task 14 audit instead
pnpm --filter @carbon/database typecheck && pnpm --filter @carbon/database test && pnpm --silent db:check:datasets
# Expected: green ×4
```
**Out of scope:** payments/settlements (C9); RMA credit memos (C9).

## Task 7: Cluster C5 — purchasing matrix, returns, OSP, FX

**Depends on:** Task 6
**Files:** `datasets/types.ts`, `tiers/05-purchasing.ts`, `data/*/purchasing.ts`, `validate.ts`
**New capabilities (PurchasingData):**
- Direct PO specs cover remaining statuses: Planned, Closed, Rejected, Needs Approval, To Review, Completed; one PO `purchaseOrderType: "Outside Processing"` referencing the OSP supplier process from foundation.
- One PO in EUR against the EUR supplier (`currencyCode`, `exchangeRate` on the PO per Insert type), left unpaid.
- Receipts: `ReceiptSpec.status` gains `"Posted"` + `postedOffset`; posted receipt writes per-line `itemLedger` (`entryType: "Purchase"`, documentType `"Purchase Receipt"`, positive, `receivedQuantity` set); one partial posted receipt (received < ordered); one Voided.
- For the batch-tracked receipt line: also create a `trackedEntity` (Purchased source) linked per the traceability idiom used in tier 03 — read how `itemTracking`/`trackedEntity.sourceDocument` values are used for receipts (`itemTrackingSourceDocument` "Receipt").
- Purchase invoices: statuses Open/Overdue/Paid/Partially Paid/Voided/Debit Note Issued (+`key` registered as `pinv:<key>` for C9).
- `purchaseReturnOrders`: Draft / To Ship / Completed (+ ledger out rows on Completed).
- Supplier quote `status` becomes authorable (`Draft | Active | Expired | Declined`) — replace the hardcode; add one of each beyond the RFQ trio (keep RFQ trio Active).
- `purchaseOrderStatusHistory` rows for one PO.
**Verify:** standard loop.
**Out of scope:** payments/memos (C9); supplier approval workflow tables (EE-adjacent `approvalRequest` — excluded per spec).

## Task 8: Cluster C6 — production depth + picking

**Depends on:** Task 7
**Files:** `datasets/types.ts`, `tiers/06-production.ts`, `datasets/helpers/job-method.ts`, `data/*/production.ts`, `validate.ts`
**New capabilities (ProductionData):**
- `JobSpec.deadlineType` authorable (all four values across the 8 jobs); `JobSpec.operationOverrides?: { order: number; status: JobOperationStatus }[]` applied after `copyMethodToJob` → unlocks `In Progress` and `Waiting` ops on the in-progress job.
- `quantities`: authorable `productionQuantity` specs per job `{ type: "Production" | "Scrap" | "Rework"; quantity; scrapReason? }` (scrapReason resolved from bootstrap `scrapReason` rows loaded into refs). Add Scrap(2, with reason) + Rework(1) to the in-progress job.
- One `rework` row if the `rework` table's Insert type is satisfiable from job/operation refs (read type; else drop with a spec note — escape hatch).
- `jobOperationNote`: 1–2 notes on in-progress job ops. `jobOperationBatch`: ONE Active batch on the in-progress job's first op if Insert type is satisfiable from (operation, quantities); else escape hatch.
- Open MES event: extend the shifts/events spec so ONE production event for `ctx.userId` has `endTime: null` (Setup, started ~1h ago via `resolveTimestamp`).
- `pickingLists`: `{ key; status: "In Progress" | "Completed"; jobKey; lines: { item; quantityRequired; quantityPicked; status: "Pending" | "Picked" | "Short"; fromShelf }[] }` → `pickingList` + `pickingListLine` (read Insert types; link to job + location). Completed list's Picked lines write paired `"Transfer"` ledger rows shelf→lineside (work-center floor unit from foundation refs). In-Progress list has Pending + one Short line, no ledger.
- Quote methods attempt: mirror `copyMethodToJob` as `copyMethodToQuote` filling `quoteMakeMethod`/`quoteMaterial`/`quoteOperation` for the SENT quote's lines (adopt interceptor-created `quoteMakeMethod` rows like tier 6 adopts jobMakeMethod). Time-box: if the interceptor/row graph fights back after 2 honest attempts, drop, record in spec (Decision 9 fallback), and continue.
**Verify:** standard loop.
**Out of scope:** scheduling engine rows (`capacityReservation`), jobOperationDependency.

## Task 9: Cluster C7 — quality depth

**Depends on:** Task 8
**Files:** `datasets/types.ts`, `tiers/07-quality.ts`, `data/*/quality.ts`, `validate.ts`
**New capabilities (QualityData):**
- NCR: authorable `type` (name resolved against bootstrap `nonConformanceType` rows), add a **Closed** NCR (with `closeDateOffset` per Insert type); priorities across all four; one `source: "External"` NCR with `nonConformanceSupplier` + `nonConformancePurchaseOrderLine` associations; add `nonConformanceCustomer`, `nonConformanceSalesOrderLine`, `nonConformanceTrackedEntity` on others; task depth: 1–2 `nonConformanceActionTask` (Containment/Corrective, varied `nonConformanceTaskStatus`), 1 `nonConformanceApprovalTask` (MRB), 1 `nonConformanceReviewer`; required-action link via bootstrap `nonConformanceRequiredAction` rows if the task tables reference them (read types).
- `inspections`: ONE inspection story on the posted receipt (C5): `inspection` (status `Passed` or `Partial`), 2 `inspectionSample` rows (one Passed one Failed), 2–3 `inspectionMeasurement` rows; plus ONE `inspectionSamplingPlan` (AQL, ANSI_Z1_4, level II) on the received item. Read all four Insert types first; source doc "Receipt".
- `qualityDocuments`: 3 (`Draft`/`Active`/`Archived`) with a couple of `qualityDocumentStep` rows on the Active one (if step table Insert is satisfiable).
- `gauges`: 3 gauges (2 Active incl. one Master role, 1 Inactive), types from bootstrap `gaugeType`; `gaugeCalibrationRecord` rows producing all three `gaugeCalibrationStatus` values (calibration status may live on gauge — read types and place accordingly).
- `risks`: ≥4 `riskRegister` rows: statuses Open/In Review/Mitigating/Closed(or Accepted), one `type: "Opportunity"`, sources spread (Customer/Supplier/Item/Job) with the matching FK columns per Insert type.
**Verify:** standard loop.
**Out of scope:** `inspectionDocument`/ballooning (file-adjacent), issue workflows (`nonConformanceWorkflow` — verify shape; include ONLY if a plain row links NCR→existing issue workflow config without file payloads, else skip with spec note).

## Task 10: Cluster C8 — change-order lifecycle

**Depends on:** Task 9
**Files:** `datasets/types.ts`, `tiers/08-change-orders.ts`, `data/*/change-orders.ts`, `validate.ts`
**Steps:** add three more change orders per dataset with statuses `Start`, `Engineering Complete`, `Cancelled` (types Engineering/Manufacturing/Documentation spread); attach 1–2 `changeOrderActionTask` rows with varied `changeOrderTaskStatus` (read Insert type; required-action from bootstrap `changeOrderRequiredAction`); keep existing three orders untouched.
**Verify:** standard loop.
**Out of scope:** additional Version/Revision method clones (method churn risks structural sums).

## Task 11: Cluster C9 — accounting depth

**Depends on:** Task 10
**Files:** `datasets/types.ts`, `tiers/09-accounting.ts`, `data/*/accounting.ts`, `validate.ts`
**New capabilities (AccountingData):**
- `journalEntries`: extend `accountClass` union to all five classes; add 2 Posted entries (balanced, business-flavored: payroll accrual, depreciation) and 1 Reversed pair (original + reversal linked per `journalEntry`/`journal` reversal columns — read types).
- `periods`: tier ensures `accountingPeriod` rows for the trailing 12 months (derive from anchor via `previousMonthEnd`-style helpers; check uniqueness/insertMaybe — table may be companyId-scoped with fiscal linkage; read types); mark the oldest seeded period `periodCloseStatus` Closed and one Locked; write 2–3 `periodCloseTask` rows (statuses Open/Done/Skipped) for the current period referencing bootstrap `periodCloseTaskDefinition`.
- `exchangeRates`: EUR rate today + 3 history points (`exchangeRate` + `exchangeRateHistory` if present — read types).
- `payments`: `{ key; type: "Receipt" | "Disbursement"; amount; dateOffset; customer?/supplier?; applies: { invoiceKey; amount }[] }` → `payment` + `invoiceSettlement` rows against C4/C6 invoice keys (`sinv:`/`pinv:` refs). Fully settle the Paid invoices; partially settle the Partially Paid ones. Respect base-vs-document amounts (all settled invoices are USD by design — the EUR PO/invoice stays unpaid; see `.claude/rules/numeric-precision.md` accounting boundaries).
- `memos`: 1 Posted credit memo (customer, tied to the Credit Note Issued sales invoice) + 1 Posted debit memo (supplier).
- `projects`: 2 rows; link one to a job if `job.projectId` exists (read type).
- `dimensionValues`: 2 `dimensionValue` rows on a bootstrap Custom dimension + `journalLineDimension` on one posted journal line (read types; skip journalLineDimension if it demands sync-ledger coupling — escape hatch).
- Fixed assets: add one **Disposed** asset + `fixedAssetDisposal` (Sale) — extend `FixedAssetSpec.status` union; add one Units of Production asset + 2 `fixedAssetUsageLog` rows if table Insert is satisfiable.
- Fix the journal-skip trap: the existing "skip if journalEntryId exists" guard stays (wipe preserves journals) but log now surfaces via Task 1's failure-only log path.
**Verify:** standard loop.
**Out of scope:** costLedger (valuation report feeds from item ledger/costs; confirmed out), card transactions, intercompany, sync tie-out.

## Task 12: Cluster C10 — ops slice (maintenance/HR/training) + workflow runs

**Depends on:** Task 11
**Files:** `datasets/types.ts` (new `ops: OpsData` slice on Dataset), `tiers/10-ops.ts` (real implementation), `tiers/11-workflows.ts`, `data/*/ops.ts` (new file), `data/*/index.ts` (register slice), `data/*/workflows.ts`, `validate.ts`
**New capabilities:**
- `OpsData.maintenanceSchedules`: ≥3 per dataset (work-center-linked, frequencies spread) → `maintenanceSchedule` (+`maintenanceScheduleItem` if NOT NULL-required).
- `OpsData.maintenanceDispatches`: 5 — one per status (Open/Assigned/In Progress/Completed/Cancelled), severity/priority/source/OEE-impact spread, failure modes from bootstrap `maintenanceFailureMode`, work-center refs; the Completed one consumes a consumable via the dispatch-item table (read `maintenanceDispatch*` child Insert types; issue = itemLedger `Negative Adjmt.` documentType consistent with app behavior — check MES `dispatch.$dispatchId.add-and-issue` service for the documentType used and mirror it).
- `OpsData.trainings`: 2 courses (Active + Draft) with ≥5 `trainingQuestion` rows covering all five `trainingQuestionType` values on the Active one; `trainingAssignment` rows for `ctx.userId` (one Completed w/ completion row if table exists, one Pending).
- `OpsData.timecards`: ≥5 `timeCardEntry` rows for `ctx.userId` over the past week (read Insert type for start/end/work-center columns).
- `OpsData.suggestions`: 2 `suggestion` rows. `OpsData.notes`: 2 `note` rows (one on a job, one on a customer — read `note` Insert type for the polymorphic id columns).
- Workflow runs (tier 11): for the published workflow, seed 3 terminal `workflowRun` rows (Succeeded / Failed / Skipped, `isTest: false`, `completedAt` set, `sourceEventId` `"seed:<n>"`) + `workflowStepRun` rows (trigger step + one action step each, per the run-history rule's shapes — read `.claude/rules/workflow-run-history.md` and both Insert types; `versionId` = the published version).
**Verify:** standard loop.
**Out of scope:** peopleAbsence/peopleAssignment (thin UI value), lessonCompletion/challengeAttempt (academy).

## Task 13: Row-count floors in verify.ts

**Depends on:** Task 12
**Files:**
- Create: `packages/database/src/datasets/coverage.ts` — `export const COVERAGE_FLOORS: Record<string, number>` listing every seeded table and its minimum row count (derive actuals from Task 14's first seed run; floor = actual for singletons, actual−20% rounded down for volume tables).
- Modify: `packages/database/src/datasets/verify.ts` — after `applyDatasetTiers`, before ROLLBACK: one query per floors entry (`SELECT count(*) FROM "<table>" WHERE "companyId" = $1` — skip the WHERE for the global `period` table), collect all failures into the returned error as `table <t>: expected ≥ N, got M`.
**Verify:**
```bash
pnpm --filter @carbon/database typecheck && pnpm --silent db:check:datasets
# Expected: ✓ ×4. Then temporarily set one floor above actual → expect ✗ naming the table; revert.
```
**Out of scope:** structural sums (stay in the manual baseline procedure).

## Task 14: Full verification — seed, audit matrix, re-apply, baselines

**Depends on:** Task 13
**Steps:**
1. `pnpm db:seed:dev -- --email demo-audit@carbon.local --dataset satellite` (bootstraps a scratch user+company; does NOT touch the user's own company).
2. Audit script (one-off, `.ai/scratch/` or scratchpad): psql against `postgresql://postgres:postgres@localhost:57312/postgres` printing `SELECT DISTINCT status FROM <table> WHERE "companyId" = <scratch>` for every status-bearing table in the spec §B matrix; save output to `.ai/runs/2026-09-22-demo-data-status-audit.txt`; verify every ✱ value appears; fix data and re-run until complete.
3. Re-apply check: `pnpm db:seed:dev -- --email demo-audit@carbon.local --dataset robotics` over the same company (exercises `wipeFirst`); must complete green; spot-check `assertSingle` didn't fire and counts match robotics.
4. Capture new baselines: the seed's `Seeded row counts` block → `.ai/runs/2026-09-22-seed-baseline-<key>.txt` for all four (satellite also structural sums per the rule doc's procedure).
5. Full gates: `pnpm --filter @carbon/database typecheck && pnpm --filter @carbon/database test && pnpm run lint` (lint scoped if the repo command is slow: `pnpm exec biome check packages/database/src/datasets`).
6. Deliberate-failure drill (acceptance #1/#2): break a ref, confirm `git commit` (dry: run `.husky/pre-commit` directly with the file staged) blocks with the named violation; revert.
**Verify:** audit file complete; all commands green; working tree has only intended changes (`git status`).

## Task 15: Docs — rule file + AGENTS.md + spec appendix

**Depends on:** Task 14
**Files:**
- Modify: `.claude/rules/onboarding-company-templates.md` — new slices, the pure validator, floors, new baseline paths, updated "Adding an industry" (12 slices incl. ops), corrected drift-check description (now blocks on internal inconsistency even with DB down).
- Modify: `packages/database/src/datasets/AGENTS.md` — same, local detail.
- Modify: `.ai/specs/2026-09-22-demo-data-completeness.md` — final Autonomous Decisions additions (anything re-decided via escape hatches), acceptance checklist ticked with evidence pointers.
**Verify:** `pnpm --silent db:check:datasets` one last time; `git status` shows only the intended files.
