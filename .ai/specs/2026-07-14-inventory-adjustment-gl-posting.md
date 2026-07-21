# Inventory Adjustment GL Posting — Unified Posting Path for Manual Adjustments, Counts, and Shop Floor

> Status: draft
> Author: Claude (with Brad Barbin)
> Date: 2026-07-14
> Research: `.ai/research/inventory-adjustment-gl-posting.md` (SAP / NetSuite / Fishbowl / Epicor survey)
> Parent: `.ai/specs/2026-07-04-inventory-valuation-completeness.md` §4 ("Quantity-adjustment GL posting", PR 4) — this spec expands and supersedes that sketch
> Companion: `.ai/specs/2026-07-14-inventory-value-report.md` (the tie-out panel whose known-noise caveat this feature removes)

## TLDR

Manual quantity adjustments write `itemLedger` rows only — no `costLedger`, no
journal — so every cycle count silently breaks the inventory-account-to-subledger
tie the valuation workbench now surfaces. This spec unifies all three adjustment
writers (ERP quantities/item-master, MES shop floor, `post-inventory-count`)
behind a new **`post-inventory-adjustment` edge function** running one Kysely
transaction that books the item ledger, maintains cost layers (negative
adjustments consume via `calculateCOGS`, positive adjustments create a layer at
current cost), and posts a balanced journal — `Dr/Cr` inventory
(`resolveInventoryAccount`: Raw Materials / Finished Goods) against
`accountDefault.inventoryAdjustmentVarianceAccount` (5310, seeded, zero writers
today). The ERP and MES service functions become thin wrappers with unchanged
signatures; `post-inventory-count` reuses the same shared posting core so count
variances and rectify corrections post identically. Storage-unit transfers stay
GL-free (not valuation events). For history, a **Reconcile action** on the
valuation tie-out panel generates a pre-populated **draft adjusting journal**
for the residual variance that an accountant reviews and posts — no automated
backfill. Design follows the SAP/NetSuite immediate-posting consensus (research
§1) and Carbon's own `post-receipt`/`post-shipment` pattern.

## Problem Statement

Verified current state (paths from repo root):

1. **Three independent adjustment writers, all quantity-only:**
   - ERP `insertManualInventoryAdjustment`
     (`apps/erp/app/modules/inventory/inventory.service.ts:1442`) — handles
     Positive/Negative/Set Quantity, storage-unit transfers, tracked-entity
     readableId/expiry, serial/batch resolution. Sequential supabase-client
     writes, **no transaction**. Called from
     `routes/x+/inventory+/quantities+/$itemId.adjustment.tsx`.
   - MES `insertManualInventoryAdjustment`
     (`apps/mes/app/services/inventory.service.ts:439`) — a separate, simpler
     copy (sign-normalize + one insert). Called from `routes/x+/adjustment.tsx`.
   - `post-inventory-count` edge function
     (`packages/database/supabase/functions/post-inventory-count/index.ts`) —
     posts count variances and rectify corrections as `Positive/Negative Adjmt.`
     ledger rows in a Kysely transaction, explicitly commented *"item ledger
     only … no GL journal lines"* (line 44).
2. **No journal is ever written.** `inventoryAdjustmentVarianceAccount` (5310)
   was seeded NOT NULL by the chart reset (`20260315000000`) and has **zero
   writers**. The tie-out panel (`get_inventory_tie_out`,
   `20260715021050_inventory-valuation-rpc.sql`) carries the permanent caveat
   *"Manual quantity adjustments don't post to the GL yet…"*
   (`InventoryValuationWorkbench.tsx`).
3. **No cost-layer maintenance either.** Negative adjustments do not consume
   FIFO/LIFO layers and positive adjustments do not create them — so after a
   negative adjustment, open layers exceed physical stock: the valuation RPC's
   effective unit cost is computed from layers that already left the building,
   and later shipments relieve COGS from phantom layers.
4. Every prerequisite already exists: `appliesToCostLedgerId` + child-aware
   `calculateCOGS` (`20260710033458`, completeness PR 1),
   `resolveInventoryAccount` (`shared/get-posting-group.ts:18`),
   `getCurrentAccountingPeriod` + the `FOR SHARE` period-close posting guard
   (`20260713235930`), and `journalEntrySourceType` already contains
   `'Inventory Adjustment'` (`20260402000000`).

## Resolved Questions (answered before writing, 2026-07-14)

- [x] **Where does posting live?** — *(Brad)* **Unify inventory adjustments into
  an edge function using a Kysely transaction, used by both ERP and MES.**
  Supersedes the parent spec's service-level sketch, which predated
  `post-inventory-count` and would have left three non-atomic implementations.
- [x] **User-entered cost on positive adjustments?** — *(Brad)* **No cost input
  in v1.** Positive adjustments always post at the item's current cost; the
  future revaluation document (parent spec §2) is the price-correction tool.
  Negative adjustments never take a cost (SAP/NetSuite consensus, research §2).
- [x] **Historical unposted adjustments?** — *(Brad)* **Reconcile action in the
  valuation workbench** (initially "true-up"; renamed per Brad, 2026-07-14 —
  "Reconcile" is the widely understood verb; the journal it drafts is an
  adjusting entry). A button on the tie-out panel generates a **draft** manual
  journal for the residual per-account variance; a human reviews and posts it.
  No automated backfill migration.

Settled by codebase precedent / parent spec (recorded here, not re-asked):
offset account is **5310 by id** (parent decision 8 + "never resolve control
accounts by number" lesson); inventory side via **`resolveInventoryAccount`**;
storage-unit transfers are **not valuation events** (no GL, no cost layers —
layers are company-scoped, `costLedger` has no `locationId`); **no void path**
for adjustments — corrections are opposite adjustments (SAP MI07 precedent;
count Rectify already models this via `correctionOfItemLedgerId`); **reason
codes deferred** (research §Recommended 7; flat defaults per the
no-matrix-config lesson); **postingDate = current date** into the current open
accounting period.

## Proposed Solution

### 1. New edge function: `post-inventory-adjustment`

`packages/database/supabase/functions/post-inventory-adjustment/index.ts`,
registered in `config.toml` (`verify_jwt = true`), authored per
`.ai/rules/workflow-edge-function.md`:

- **Payload** (zod): the current `inventoryAdjustmentValidator` contract —
  `adjustmentType` (`Positive Adjmt.` | `Negative Adjmt.` | `Set Quantity`),
  `itemId`, `locationId`, `storageUnitId`, `trackedEntityId?`, `quantity`,
  `readableId?`, `originalStorageUnitId?`, `expirationDate?`, `comment?` — plus
  `companyId`, `userId`, and optional `documentType`/`documentId`/
  `correctionOfItemLedgerId` (used by the count path).
- **Auth**: `requirePermissions(req, companyId, userId, { update: "inventory" })`.
- **Body**, one `db.transaction()`:
  1. **Resolve intent** — the logic currently in the ERP service moves here
     verbatim: `Set Quantity` → signed delta (no-op when unchanged);
     storage-unit-transfer detection (negative+positive pair); serial/batch
     stock-target resolution; tracked-entity quantity/status writes and
     readableId/expiry handling (expiry override keeps routing through the
     `updateTrackedEntityExpiry` semantics so `attributes.expiryOverrides`
     traceability is preserved).
  2. **Item ledger** — insert the same row shapes as today (entry types,
     comment, tracked-entity linkage, `correctionOfItemLedgerId` passthrough).
  3. **Cost layers** (always, even when accounting is disabled — the
     `post-receipt` precedent):
     - *Negative*: `calculateCOGS(trx, { itemId, quantity, companyId })` —
       consumes FIFO/LIFO layers + adjustment children, decrements
       `remainingQuantity`, falls back to `itemCost.unitCost` when layers are
       insufficient; Average/Standard cost from `itemCost`.
     - *Positive*: insert a `costLedger` layer (`itemLedgerType` = the entry
       type, `costLedgerType 'Direct Cost'`, `quantity`, `remainingQuantity =
       quantity`, `cost = quantity × currentUnitCost`) where `currentUnitCost`
       is `standardCost` (Standard), `unitCost` (Average), or the
       weighted-average of open layers incl. applied children with `unitCost`
       fallback (FIFO/LIFO — the valuation RPC's carrying expression).
     - *Storage-unit transfers*: none.
  4. **Journal** — only when `companySettings.accountingEnabled` AND the item
     is valuated (`itemTrackingType !== 'Non-Inventory'`) AND the movement is
     not a storage-unit transfer:
     - `journal`: `sourceType 'Inventory Adjustment'`, `postingDate` = today,
       `accountingPeriodId` via `getCurrentAccountingPeriod` (the `FOR SHARE`
       period guard applies automatically), `status 'Posted'`.
     - Two `journalLine`s sharing a `journalLineReference` (nanoid), amounts via
       the `debit()`/`credit()` sign helpers, `accountId` (never number):
       | Direction | Debit | Credit |
       |---|---|---|
       | Positive Adjmt. | inventory account (`resolveInventoryAccount`) | 5310 |
       | Negative Adjmt. | 5310 | inventory account |
       at the §1.3 cost. `documentType 'Inventory Adjustment'` (manual) or
       `'Inventory Count'` (count path), `documentId` = the count id or the
       item-ledger entry id, `quantity` = adjusted quantity. (The item-ledger
       and cost-ledger rows keep their own `itemLedgerDocumentType` — NULL for
       manual adjustments, as today; `costPostedToGL` no longer exists on
       `costLedger`.) Every journal line is tagged with
       `journalLineDimension` rows for the movement's **Item /
       ItemPostingGroup / Location**, for whichever dimensions are active on
       the company group (post-shipment precedent; Brad, 2026-07-15).
- The posting core (steps 2–4) lives in a shared module
  `functions/shared/post-adjustment.ts` so `post-inventory-count` reuses it.

### 2. ERP + MES services become thin wrappers

Both `insertManualInventoryAdjustment` functions keep their exact signatures
and `{ data, error }` return shape but delegate to
`client.functions.invoke("post-inventory-adjustment", { body })`. Route callers
(`quantities+/$itemId.adjustment.tsx`, MES `x+/adjustment.tsx`) are untouched.
One implementation of adjustment semantics replaces today's two-and-a-half.

### 3. `post-inventory-count` gains the posting legs — including Rectify

The count flow's snapshot-delta semantics are preserved exactly; only the
posting legs are added:

- **First post**: each counted line posts the reviewed variance —
  `counted − frozen snapshot systemQuantity`, per `planInventoryCountPost` —
  and the per-line loop calls the shared posting core instead of raw
  `itemLedger` inserts, so each delta now maintains cost layers and adds a
  journal-line pair (`documentType 'Inventory Count'`, `documentId` = count
  id) inside the function's existing transaction and `FOR UPDATE` double-post
  guard. A count post creates **ONE journal** shared by all its lines (Brad,
  2026-07-15) — created lazily on the first variance that carries value, so an
  all-zero-cost post writes no empty journal. Each Rectify re-post likewise
  gets one journal of its own.
- **Rectify** (`rectifyInventoryCount`, `inventory.service.ts:2207`): reopening
  a Posted count re-snapshots each line's `systemQuantity` to current live
  on-hand and **posts nothing** by itself. The subsequent re-post sends the
  *incremental* delta through the same core, linked to the line's prior
  movement via `correctionOfItemLedgerId` (`postedItemLedgerId` bookkeeping and
  the tracked-entity delta-apply are unchanged). A rectify correction is a new
  adjustment, **not** a reversal of the original entry.
- **Correction valuation**: each posting event is valued at cost at *its own
  posting time* (layer consumption / current cost) — the original journal is
  never mutated or reversed at its original amount. If cost moved between the
  original post and the rectification, a residual correctly remains in 5310:
  the interim period really carried that gain/loss. Movements stay linked for
  audit via `correctionOfItemLedgerId`; all of a count's journals share its
  `documentId`.
- `getInventoryCountMovements` keeps working unchanged (same ledger
  back-references, corrections included).

### 4. Tie-out Reconcile action (cutover path)

On the valuation workbench tie-out panel, a **"Reconcile"** action (visible
when `accountingEnabled` and variance ≠ 0; gated by
`permissions.can("create", "accounting")`). Naming: the *panel* stays the
tie-out (the check); **Reconcile** is the action; the artifact is a draft
**adjusting journal** — the QuickBooks/NetSuite reconcile-then-adjusting-entry
pattern.

- New route action `x+/inventory+/valuation.reconcile.tsx`
  (`requirePermissions { create: "accounting" }`) calls a new
  `createInventoryReconciliationJournal` service function that reuses the
  existing manual-journal machinery (`upsertJournalEntry` /
  `upsertJournalEntryLine`, `sourceType 'Manual'`): one **Draft** journal, one
  line pair per account row with nonzero variance — `Dr/Cr` inventory account
  vs 5310 — description stamped *"Inventory subledger reconciliation as of
  {asOfDate}"*.
- Redirects to the journals screen for review/edit/post. The tie-out already
  excludes Draft journals, so the variance clears only when the accountant
  posts.
- Panel copy: the old caveat is removed entirely with **no replacement text**
  (Brad, 2026-07-15) — when a variance exists the popover simply offers the
  Reconcile button; at zero variance the button hides too.

### 5. Documentation + parent-spec sync

- Update parent spec §4 with a pointer to this spec; changelog entries in both.
- `.ai/rules/inventory-system.md` gains the new posting path;
  `docs/` inventory + accounting pages updated per the carbon-docs flow.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Multi-tenancy (heuristic 1) | No new tables. Every write carries `companyId` + audit fields; payload `userId` is required (zod) so `createdBy` is never NULL | House convention; "never feed a nullable user id into a NOT NULL audit column" lesson |
| 2 | Service shape (heuristic 2) | Wrappers keep `client`-first `{data,error}` signatures; posting math in the edge function + `shared/post-adjustment.ts` | Brad's unification decision; matches the `post-*` family |
| 3 | RLS (heuristic 3) | N/A — no new tables; edge function runs service-role behind `requirePermissions` | Same guard model as `post-receipt`/`post-inventory-count` |
| 4 | Permissions (heuristic 4) | Edge fn: `update: "inventory"` (same as today's adjustment routes). Reconcile: `create: "accounting"` | Adjusting stock is an inventory action; creating journals is an accounting action |
| 5 | Forms (heuristic 5) | Adjustment form unchanged (no cost input — resolved Q2); Reconcile reuses the existing journal-entry surface | Minimal UI delta; revaluation doc is the price tool |
| 6 | Module layout (heuristic 6) | No new modules; service additions stay in `inventory.service.ts`; workbench edit in `ui/Valuation/` | One service/models file per module |
| 7 | Backward compatibility (heuristic 7) | Additive enum values; wrapper signatures unchanged; `accountingEnabled = false` ⇒ itemLedger byte-identical + layers maintained (post-receipt precedent), no journal | No frozen surface touched |
| 8 | Offset account | `accountDefault.inventoryAdjustmentVarianceAccount` (5310), resolved by id, both directions | Parent decision 8; account exists seeded NOT NULL; single quantity-variance account (SAP GBB-INV shape) |
| 9 | Positive-adjustment cost | Current cost by method: `standardCost` / `unitCost` / weighted-avg open layers (fallback `unitCost`) | Resolved Q2; keeps journal = valuation RPC math |
| 10 | Negative-adjustment cost | `calculateCOGS` consumption (layers + children; underwater fallback `unitCost`) | Single source of relief math with shipments/backflush |
| 11 | Storage-unit transfers | No costLedger, no journal — ledger pair only | Value doesn't move between bins; naive posting would leak P&L when layer cost ≠ current cost |
| 12 | Corrections/void | No void; corrections are new incremental adjustments valued at posting-time cost (count Rectify re-post links via `correctionOfItemLedgerId`; original journals immutable) | SAP PI precedent (no cancel of a posted difference); the Rectify flow (`20260713015508`) already models correction-as-new-movement |
| 13 | Reason codes | Deferred; `comment` lands in journal/ledger descriptions as the seam | Research §Recommended 7; no-matrix-config lesson; scrap-vs-shrinkage split is the first future refinement |
| 14 | Backfill | None automated; Reconcile draft adjusting journal (resolved Q3) | Fabricating history at current costs into the current period is worse than an explicit cutover entry |

## Data Model Changes

No new tables. One migration (`pnpm db:migrate:new inventory-adjustment-gl-posting`,
HHMMSS randomized, idempotent):

```sql
-- Journal document linkage for adjustment postings (additive; enum ADD VALUE
-- must not share a transaction with statements that use the value)
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Inventory Adjustment';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Inventory Count';
```

`journalEntrySourceType` already contains `'Inventory Adjustment'` — no change.
Plus `config.toml`: `[functions.post-inventory-adjustment] enabled = true,
verify_jwt = true`. Run `pnpm run generate:types` before typechecking.

## API / Service Changes

- **New** edge function `post-inventory-adjustment` (§1) + shared
  `functions/shared/post-adjustment.ts` posting core.
- `post-inventory-count/index.ts`: per-line posting via the shared core (§3).
- ERP `inventory.service.ts`: `insertManualInventoryAdjustment` → wrapper
  invoking the edge function (signature unchanged); **new**
  `createInventoryReconciliationJournal(client, companyId, { asOfDate, userId })`.
- MES `services/inventory.service.ts`: `insertManualInventoryAdjustment` →
  same wrapper.
- **New route** `x+/inventory+/valuation.reconcile.tsx` (action only,
  `create: "accounting"`).
- No models changes (form contract unchanged). No Inngest.

## UI Changes

- `InventoryValuationWorkbench.tsx`: tie-out popover gains the Reconcile button
  + replaced caveat copy (§4). All new strings through Lingui.
- No changes to the adjustment forms (ERP `InventoryAdjustmentForm`, MES
  `AdjustInventory`) or the count UI beyond what posting returns.

## Acceptance Criteria

- [ ] **Negative adjustment (numeric).** FIFO item with an open layer 20 @ $7.00:
  a −10 adjustment posts Dr Inventory Adjustment (5310) $70.00 / Cr Raw
  Materials $70.00; the layer's `remainingQuantity` drops 20 → 10; itemLedger
  −10; journal `sourceType 'Inventory Adjustment'`, `documentType 'Inventory
  Adjustment'`.
- [ ] **Positive adjustment (numeric).** Same item, +5: Dr Raw Materials $35.00
  / Cr 5310 $35.00; a new costLedger layer (qty 5, cost $35.00, remaining 5);
  a later shipment of 15 consumes 10 from the old layer and 5 from the new one.
- [ ] **Account routing.** A `Make` item's adjustment debits/credits Finished
  Goods; a `Buy` item's hits Raw Materials — matching the tie-out's account rows.
- [ ] **Set Quantity.** Setting on-hand 12 → 12 writes nothing; 12 → 9 posts a
  −3 adjustment (delta semantics, layers preserved — the NetSuite worksheet
  lesson).
- [ ] **Storage-unit transfer.** Moving a tracked batch between bins writes the
  ledger pair and zero costLedger/journal rows; tie-out variance unchanged.
- [ ] **Count posting.** Posting a count with one +2 and one −4 variance line
  writes **one journal** containing a balanced line pair per variance line
  (four lines total), `documentType 'Inventory Count'` / `documentId` = count
  id; the count's status/`postedItemLedgerId` bookkeeping and
  `getInventoryCountMovements` behave exactly as today.
- [ ] **Rectify (numeric).** A count posts −10 against a $7.00 layer
  (Dr 5310 $70.00 / Cr Inventory $70.00). Rectify the count, re-count so the
  line's delta is +4: the re-post writes a +4 movement linked via
  `correctionOfItemLedgerId`, posts Dr Inventory / Cr 5310 at *current* cost
  (not necessarily $7.00), never mutates the original journal, and
  `getInventoryCountMovements` lists both movements linked.
- [ ] **MES parity.** A shop-floor adjustment posts through the same edge
  function with identical GL results.
- [ ] **Accounting disabled.** With `accountingEnabled = false`: itemLedger
  writes byte-identical to today, cost layers still maintained, zero journals.
- [ ] **Non-valuated items.** `Non-Inventory` tracking-type adjustments never
  write journals.
- [ ] **Tie-out closes.** Fresh company, accounting enabled: receive 10 @ $8.00,
  adjust −2 → subledger $64.00, GL $64.00, variance $0.00, and the old caveat
  copy is gone.
- [ ] **Reconcile.** A company with historical variance (RM −$120.00): the
  Reconcile action creates a **Draft** journal Dr 5310 $120.00 / Cr Raw
  Materials $120.00 stamped with the as-of date; the tie-out still shows the
  variance until the journal is posted, then reads $0.00; the button hides at
  zero variance and for users without `accounting_create`.
- [ ] **Period guard.** Posting an adjustment while the current period is
  Closed fails cleanly with no partial writes (no ledger row without its
  journal).
- [ ] **Atomicity.** Forcing a journal-insert failure mid-transaction leaves no
  itemLedger/costLedger rows behind.
- [ ] `pnpm run generate:types` then
  `pnpm exec turbo run typecheck --filter=erp --filter=mes` passes; migration
  re-runs safely.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Behavior drift porting the ERP function's tracked-entity/serial/bin logic into Deno | High | Port verbatim; keep wrapper signatures so every caller is unchanged; cover serial, batch, Set Quantity, and bin-transfer cases in acceptance testing + `/test` browser verification of the quantities page, MES adjustment, and count post |
| Adjustments now deplete layers — later COGS changes vs today | Med | Correct by design (today's behavior is the bug); called out in docs; acceptance criterion pins the consumption order |
| Underwater negatives (insufficient layers) valued at `unitCost` fallback | Low | Exact `calculateCOGS` precedent shipments already use; NetSuite documents the same estimate-and-correct semantics |
| Count posting latency (per-line COGS in one txn) | Med | Single transaction, module-scope pool, batch line loop — same shape as `post-receipt`'s multi-line posting; measure on a seeded 100-line count |
| Reconcile journal posted twice / stale amount | Low | Journal is Draft + human-reviewed; description stamps the as-of date; button recomputes variance live |
| Edge-function invocation failure leaves UI ambiguous | Low | Wrappers surface `{ error }` unchanged; routes already flash errors; no optimistic ledger writes remain app-side |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] Posting architecture — **unified edge function with a Kysely transaction,
  used by ERP and MES** (Brad, 2026-07-14).
- [x] Cost input on positive adjustments — **none in v1; always current cost**
  (Brad, 2026-07-14).
- [x] Historical variance — **Reconcile action on the tie-out panel generating
  a draft adjusting journal; no automated backfill** (Brad, 2026-07-14;
  renamed from "true-up" same day).

No new blocking questions surfaced while writing; judgment calls (transfer
exemption, correction-not-void, deferred reason codes, count documentType) are
baked as Design Decisions 11–13 and the §1.4 table, revisitable without schema
churn.

## Changelog

- 2026-07-15: One journal per inventory count post (Brad) — the shared core
  gains `accounting.getJournalId` so count lines append to a lazily created
  shared journal; manual adjustments keep one journal per movement.
  Post-review hardening: `companyId` scoping on applied-children queries,
  `quantity.min(0)` on the payload, `getFunctionLogger` over `console.error`,
  `msg`-wrapped Valuation breadcrumb.
- 2026-07-15: Journal lines from adjustments and counts carry
  Item/ItemPostingGroup/Location dimension tags (Brad) — same
  `journalLineDimension` mechanism as post-shipment.
- 2026-07-15: Tie-out popover carries no caveat text (Brad) — Reconcile button
  only, shown when variance ≠ 0 and the user has `accounting_create`.
- 2026-07-14: Created — after competitor research
  (`.ai/research/inventory-adjustment-gl-posting.md`) and a 3-question grill
  with Brad (resolutions inline). Grounded in code exploration: the three
  adjustment writers (`inventory.service.ts:1442`, MES `inventory.service.ts:439`,
  `post-inventory-count`), `calculateCOGS` + `appliesToCostLedgerId`
  (`20260710033458`), `resolveInventoryAccount` + RM/FG split (`20260713190909`),
  the 5310 seed (`20260315000000`), and the tie-out RPC (`20260715021050`).
  Supersedes parent spec §4's service-level sketch per Brad's unification
  decision.
- 2026-07-14: Renamed the cutover action "true-up" → **Reconcile** (Brad) —
  panel remains the tie-out (the check), Reconcile is the action, the artifact
  is a draft adjusting journal; route/service renamed to
  `valuation.reconcile.tsx` / `createInventoryReconciliationJournal`.
- 2026-07-14: Expanded §3 with the count Rectify flow (Brad's note) — reopen
  re-snapshots `systemQuantity` and posts nothing; the re-post posts the
  incremental delta linked via `correctionOfItemLedgerId`, valued at
  posting-time cost, original journals immutable (decision 12 + new numeric
  acceptance criterion).
