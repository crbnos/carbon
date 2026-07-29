# Plan: GL + cost posting for inspection reject & NCR disposition

Addresses the gaps in `.ai/research/2026-07-25-inspection-disposition-accounting-audit.md`: inspection/disposition move inventory quantity but post no cost or GL. Goal: every inventory-value movement in these flows also relieves/creates cost layers and posts a balanced GL journal, gated on `accountingEnabled`, reusing the proven `bookAdjustment`/`calculateCOGS` core — with a proper scrap (cost-of-quality) expense.

## Key decisions (recommendations — confirm before building)

### D1 — Accounting model: **"GL follows the physical movement"** — ✅ LOCKED (A), grill 2026-07-25
Post cost + GL at exactly the points inventory **quantity** already moves today, so the ledgers stay 1:1 with on-hand. Blocked-stock/quarantine model (B) explicitly rejected for v1 (no new Quarantine asset account, no GL on the tracked-reject path); acceptable that a tracked rejected lot's value sits in the normal Inventory GL through the MRB hold, and that non-tracked writes off at reject while tracked writes off at Scrap disposition. Quarantine remains the documented future end-state.

| Event | Qty today | Cost + GL to add |
|-------|-----------|------------------|
| Reject, non-tracked `Inventory` (`-lotSize`) | removes on-hand | relieve layers (`calculateCOGS`); **Dr Scrap, Cr Inventory** |
| Reject, tracked / `Non-Inventory` | status flip only | **none** (value stays until Scrap disposition) |
| Disposition **Scrap** (tracked `-qty`/entity; non-tracked non-inspection `-qty`) | removes on-hand | relieve layers; **Dr Scrap, Cr Inventory** |
| Disposition **Return to Supplier** | removes on-hand | v1 = same as Scrap write-off (see D3) |
| Disposition **Use As Is / Rework** restore (non-tracked, inspection `Inventory`, `+qty`) | adds on-hand | create layer; **Dr Inventory, Cr Scrap** (reverse the reject write-off) |
| Disposition Use As Is / Rework, tracked | status→Available | **none** (value never left Inventory) |
| Batch split (net-zero) | net-zero | **none** (no value change) — leave as-is |

Inventory side = `finishedGoodsAccount`/`rawMaterialsAccount` by `replenishmentSystem` (reuse `resolveInventoryAccount`). This directly fixes the user's complaint and reuses `bookAdjustment` unchanged in shape.

*Alternative (not recommended for v1): blocked-stock model* — reject reclassifies Inventory→a new **Quarantine/Nonconforming Inventory** asset account for the whole lot (tracked + non-tracked, uniform), disposition settles Quarantine→Scrap/Inventory/Receivable. More correct (doesn't expense until the scrap decision; removes the tracked/non-tracked timing asymmetry of G1/G2) but needs a quarantine account, GL on the tracked-reject path, and cost-basis timing care. Note as the future end-state.

### D2 — Scrap account: **add `scrapAccount` to `accountDefault`** — ✅ LOCKED (A + backfill), grill 2026-07-25
Dedicated column for cost-of-quality visibility distinct from physical-count adjustments. Flat additive column (well-precedented: `20260711042617_add-overhead-absorption-account.sql` etc.) — **not** a posting-group matrix.
- **Backfill (required, user-emphasized):** in the same migration, `UPDATE "accountDefault" SET "scrapAccount" = "inventoryAdjustmentVarianceAccount" WHERE "scrapAccount" IS NULL` — both are `account.id` FKs, valid per company; every existing company already has a seeded `inventoryAdjustmentVarianceAccount`, so none is left null. Idempotent (guarded on NULL). Column is **nullable** and the edge fn keeps a runtime fallback `offset = scrapAccount ?? inventoryAdjustmentVarianceAccount` as defense in depth.
- **New companies:** add a distinct **`5320 "Scrap / Cost of Quality"`** account to the seed chart (`functions/lib/seed.data.ts`), seeded as a **child of the existing `inventory-adjustments` group** (sibling of `5310`, which sits under COGS) — `{ key: "5320", number: "5320", name: "Scrap / Cost of Quality", isGroup: false, parentKey: "inventory-adjustments", accountType: "Cost of Goods Sold", incomeBalance: "Income Statement", class: "Expense", consolidatedRate: "Average", createdBy: "system" }`. It **must** have a parent (`parentKey: "inventory-adjustments"`) — no orphan accounts. Then seed `accountDefault.scrapAccount → 5320` so fresh companies get the separated P&L line out of the box. (Existing companies are NOT given a new 5320 row — the backfill points them at their existing variance account; they can reassign in the UI.)
- Add `scrapAccount` to the zod validator (`accounting.models.ts`) + a field in `AccountDefaultsForm.tsx` (Inventory section).

### D3 — Return to Supplier GL: **v1 = write-off to Scrap** — ✅ LOCKED (A), grill 2026-07-25
Return to Supplier posts the **same** movement as Scrap — Dr `scrapAccount` / Cr Inventory + relieve cost layers — because no vendor-RMA/debit-memo flow exists to book a supplier receivable. Accepted trade-off: slightly overstates cost-of-quality scrap for the (small) return population; reclassify when the supplier credit is later booked in purchasing/AP. GR/IR-clearing (B) and defer (C) rejected: (B) leaves a GR/IR balance that may never clear (already-invoiced lines) and needs the missing credit-memo flow; (C) re-strands value in Inventory. Proper vendor-RMA/debit-memo (the real home for a supplier receivable) is documented future work.

### D4 — Architecture: **new edge fn `post-nonconformance`** sharing `bookAdjustment`
Cost/GL logic is Deno-only (`functions/shared/*`); app code can't call it. Add `packages/database/supabase/functions/post-nonconformance/index.ts` that takes a batch of movements + context and calls `bookAdjustment` per movement (extended to accept an **offset-account override** so the scrap account is used instead of the variance account). It resolves the accounting period once, is gated on `accountingEnabled`, and targets **specific existing `trackedEntityId`s** (disposition scrap of a serial/batch lot). Register in `config.toml`. This mirrors how `post-inventory-count` already reuses `bookAdjustment`.

Consistency: keep tracked-entity **status flips + `trackedActivity`** where they are (app Kysely in `closeIssue`/`dispositionInspection`); the edge fn owns **itemLedger + costLedger + journal**. Order the calls so a GL failure aborts the close (invoke the edge fn, check `{error}`, only then set `status = Closed`). Reject already spans multiple route steps, so a second call there is consistent with the existing shape.

### D5 — Reversal on NCR reopen: **block reopen once GL posted** — ✅ LOCKED (A, SAP-aligned), grill 2026-07-25
When a close posted GL for this NCR, **block reopen** (`Closed→Registered`) with a clear message; guard on the existence of any `journal` (or `costLedger`/`itemLedger`) row with `documentType 'Non-Conformance'` + `documentId = ncrId`. Scope is narrow — only NCRs that actually posted GL are blocked (accounting-enabled + real inventory movements; an all-Use-As-Is/tracked NCR posts nothing and stays freely reopenable).
- **Rationale (SAP-aligned):** SAP never reopens/edits a posted document — corrections are **forward compensating reversals** (MBST / reversal movement types), posted into the current open period, original preserved for audit. In QM you post *further* stock postings against the lot rather than un-making the Usage Decision.
- **End-state (future, NOT (B)):** an explicit **"reverse & re-disposition"** action that posts compensating journals/movements in the current open period — deliberately **not** an in-place auto-unwind. This also sidesteps Carbon's real-time FIFO `costLedger` layer-relief problem (un-consuming specific layers), which SAP avoids only because its real-time valuation is MAP/standard.
- Implement in `updateIssueStatus` / `x+/issue+/$id.status.tsx` (reopen path).

## Tasks

### Phase 0 — Account + schema (D2) — ✅ DONE (migration applied, types regen, erp typecheck green)
- [x] `20260726012013_add_scrap_account.sql` — add `accountDefault.scrapAccount TEXT` (FK `account.id`, RESTRICT), idempotent backfill → `inventoryAdjustmentVarianceAccount`.
- [x] Seed `5320 "Scrap / Cost of Quality"` (under `inventory-adjustments`) + `accountDefaults.scrapAccount: "5320"` in `functions/lib/seed.data.ts`.
- [x] `scrapAccount` (optional) in `defaultIncomeAcountValidator` + field in `AccountDefaultsForm.tsx` (Standard Cost Variances, next to Inventory Adjustment).
- [x] `pnpm run generate:types`; `turbo typecheck --filter=erp` green.

### Phase 1 — `post-nonconformance` edge fn (D4) — ✅ DONE (deno check clean, erp typecheck green)
- [x] **Discovered gap + fix:** `journalLineDocumentType` and `journalEntrySourceType` lacked `Non-Conformance`/`Inbound Inspection` (only `itemLedgerDocumentType` had them). Added via `20260726013204_add_nonconformance_journal_doctypes.sql` (additive `ALTER TYPE ADD VALUE`, mirrors `20260619142853`) so NCR/inspection GL journals are first-class + traceable (like `Asset Disposal`). Also updated the ERP `journalEntrySourceTypes` const array + `JournalEntrySourceTypeIcon` (LuTriangleAlert / LuClipboardCheck) so the enum widening typechecks.
- [x] `functions/shared/post-adjustment.ts::bookAdjustment` extended additively: `accounting.offsetAccount`/`offsetDescription` (default `inventoryAdjustmentVarianceAccount`/"Inventory Adjustment") + `accounting.sourceType` + `createAdjustmentJournal` sourceType param + widened `ledger.documentType` union. `post-inventory-adjustment`/`post-inventory-count` unaffected (all new fields optional).
- [x] `functions/post-nonconformance/index.ts` — payload `{ companyId, userId, documentType, documentId, description?, postingDate?, movements: [{ itemId, locationId?, trackedEntityId?, quantity(signed), comment? }] }`; `requirePermissions(update:"quality")`; resolves period + defaults + dimensions before the txn; ONE shared journal per call (lazy `getJournalId`); offset = `scrapAccount ?? inventoryAdjustmentVarianceAccount`; sourceType = documentType. Registered in `config.toml`.
- [x] `deno check` clean (only the shared-lib baseline the reference function also shows); `turbo typecheck --filter=erp` green; biome clean.
- [ ] Runtime-exercise via the reject/close routes locally → deferred to Phase 6 (needs wiring first).

### Phase 2 — Wire inspection reject (D1 row 1) — ✅ DONE (erp typecheck + biome green)
- [x] `dispositionInspection` no longer writes the non-tracked `itemLedger`; it returns a `writeOff { itemId, quantity: -lotSize, locationId } | null` (the `status !== "Failed"` guard dropped — idempotency covers retries).
- [x] `x+/inspection+/$id.reject.tsx` invokes `post-nonconformance` with the write-off (documentType `Inbound Inspection`, documentId = inspection.id) after `dispositionInspection`; a posting failure is logged, not fatal (lot already Rejected).

### Phase 3 — Wire NCR close (D1 rows 3–6) — ✅ DONE (erp typecheck + biome + 10 tests green)
- [x] `closeIssue` refactored: preflight now loads issue + origin (`inventoryItemIds`, `inspectionOriginated`), builds `movements[]`, and invokes `post-nonconformance` (documentType `Non-Conformance`, documentId = ncrId) BEFORE the txn; a GL failure returns `errResult` and aborts the close. The txn now owns only re-validation + `trackedActivity` + status flips (`Available`/`Rejected`) + `status = Closed` — **all `itemLedger` inserts removed**.
- [x] Movement rules: tracked Scrap/Return → `-link.qty` per link; non-tracked Inventory non-inspection Scrap → `-row.qty`; non-tracked Inventory inspection Use-As-Is/Rework → `+row.qty` restore; everything else no movement.
- [x] Batch split: unchanged (net-zero, no GL).

### Phase 4 — Reopen guard (D5) — ✅ DONE (erp typecheck + biome green)
- [x] `x+/issue+/$id.status.tsx`: reopening (status ≠ Closed) an NCR that is currently `Closed` and has any `itemLedger` with `documentType='Non-Conformance'` + `documentId=ncrId` is blocked with a clear message. Guard reads via **service role** (itemLedger SELECT needs inventory/accounting_view; a quality user could fail open).

### Phase 5 — Xero adjustment-sync guard (G7) — ✅ DONE (@carbon/ee typecheck + biome green)
- [x] `InventoryAdjustmentSyncer.fetchAdjustmentsByIds` excludes `documentType IN ('Non-Conformance','Inbound Inspection','Batch Split')` while keeping NULL (manual) rows — prevents wrong/duplicate Xero ManualJournals now that NCR/inspection have their own local scrap-account journals.

### Phase 6 — Verification — ⏳ USER-OWNED (browser). Static gates all green.
- Static: `deno check` (post-nonconformance/post-adjustment, own-file clean), `turbo typecheck --filter=erp` + `--filter=@carbon/ee` green, biome clean, quality vitest 10/10.
- **Edge-runtime note:** the new `post-nonconformance` function + `config.toml` entry may need the edge-runtime container to be restarted to be served locally (`crbn up` live-mounts the functions dir; a new `[functions.*]` entry can require a restart).
- Enable accounting locally (`/x/settings/accounting`, per project memory) before testing GL.
- Suggested matrix (accounting ON): (a) receive an inspection `Inventory` item → reject → assert `journal` (sourceType `Inbound Inspection`, Dr Scrap 5320 / Cr Inventory) + `costLedger` relief + `itemLedger`; (b) serial lot → NCR Scrap → close → per-entity GL + cost relief, entities `Rejected`; (c) inspection non-tracked → Use As Is → close → `+qty` restore reverses the reject write-off; (d) MES/manual non-tracked → Scrap → close → `-qty` write-off; (e) tracked Use As Is → close → entities `Available`, **no** GL; (f) accounting OFF → `itemLedger` + cost layers only, no journal; (g) try to Reopen a closed NCR that posted → blocked.
- Confirm the inventory valuation report reconciles against the GL Inventory account; scrapped/rejected value lands in `5320`.

## Decisions — all resolved (grill 2026-07-25)
1. **Model** → **A** "GL follows the physical movement" (blocked-stock/quarantine deferred as future). See D1.
2. **Scrap account** → **A** dedicated `accountDefault.scrapAccount`, backfilled to `inventoryAdjustmentVarianceAccount`, new `5320 "Scrap / Cost of Quality"` seeded under the `inventory-adjustments` group (must have a parent). See D2.
3. **Return to Supplier** → **A** write-off to `scrapAccount`, same as Scrap. See D3.
4. **Reopen after GL** → **A** block (SAP-aligned); future "reverse & re-disposition" compensating action. See D5.
5. **Standard-cost items** → uniform: relieve `calculateCOGS` carrying cost, full amount Dr `scrapAccount` / Cr Inventory, **no variance split** at disposal (variance arises at purchase/production, not scrap). Applies in the Phase 1 valuation.

### D4 — Architecture (plan of record, not re-grilled): new `post-nonconformance` edge fn sharing `bookAdjustment`
Confirmed as the approach — cost/GL logic is Deno-only, so app code cannot post it; a new edge fn calling the shared `bookAdjustment` (extended for a scrap offset account + specific `trackedEntityId` targeting) is the consistent, atomic home. Status flips + `trackedActivity` stay in app code; the edge fn owns `itemLedger + costLedger + journal`. Details in the D4 section above and Phases 1–3.
