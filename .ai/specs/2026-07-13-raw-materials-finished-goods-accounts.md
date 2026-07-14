# Raw Materials / Finished Goods Inventory Account Split

**Date:** 2026-07-13
**Status:** Implemented on `feat/finished-goods` (uncommitted; see `.ai/plans/2026-07-13-raw-materials-finished-goods-accounts.md` for evidence)
**Owner:** Brad Barbin

## TLDR

Replace the single `accountDefault."inventoryAccount"` with two default accounts — `rawMaterialsAccount` and `finishedGoodsAccount` — and route all six automated posting flows (purchase receipts, purchase invoices, shipments, sales invoices, material issue, job completion) through a single classification rule: `item.replenishmentSystem = 'Buy'` → Raw Materials, otherwise (`Make`, `Buy and Make`) → Finished Goods. The old column is dropped entirely so the compiler surfaces every stale reference.

## Problem Statement

Carbon posts all inventory value to one GL account (seed: `1210 Inventory`). Manufacturing accounting convention separates **Raw Materials** (purchased stock and components awaiting production) from **Finished Goods** (completed products awaiting sale); **WIP** already has its own account (`1230`). With a single account:

- The balance sheet cannot show RM vs FG — a basic disclosure for any manufacturer.
- Inventory turns, E&O analysis, and absorption tracking by stage are impossible from the GL.
- Job completion journal lines are already *labeled* "Finished Goods Inventory" but post to the same account as raw stock.

Verified current state:

- Account selection in posting code uses only `itemTrackingType` (+ outside-processing flag); `replenishmentSystem` is never consulted for GL accounts.
- Posting groups (`postingGroupInventory` etc.) were fully dropped (`20260229000000`, `20260412064107`) — company-level `accountDefault` is the only source of posting accounts.
- `accountDefault` account columns FK to `account(id)` `ON DELETE RESTRICT ON UPDATE CASCADE`.
- Seed chart has `1210 Inventory`, `1230 WIP`, `1240 Inventory Reserves`; **1220 is free**.

## Resolved Questions

| Question | Resolution (Brad, 2026-07-13) |
|---|---|
| How does an item map to RM vs FG? | **Derived from `item.replenishmentSystem`**: `Buy` → Raw Materials; `Make` / `Buy and Make` → Finished Goods. Stable per item so debit and credit sides always agree (no drift). No new schema on `item`. Inventory-tracked Tools/Consumables/Fixtures are almost always `Buy` → RM. |
| How are existing companies migrated? | **Auto-create a "Finished Goods" (1220) account per company group** (precedent: PR #1127 overhead-absorption pattern) and wire `finishedGoodsAccount` to it; `rawMaterialsAccount` takes the old `inventoryAccount` value. Accepted caveat: pre-split on-hand FG value stays in the old account, so FG can go negative until a manual reclass JE. ~~Existing account names untouched.~~ **Revised 2026-07-13 (follow-up migration `20260713234852`):** existing account names were NOT untouched enough — leaving the raw-materials account named "Inventory" while new companies seed it as "Raw Materials" left existing charts asymmetric (a "Finished Goods" account but no "Raw Materials"). A follow-up migration renames each company's `rawMaterialsAccount`-designated account to "Raw Materials" regardless of its current name (guarded: posting account only, not also serving as `finishedGoodsAccount`, no same-group collision). |
| Column naming | `rawMaterialsAccount`, `finishedGoodsAccount` — matches `workInProgressAccount` style (inventory accounts without an "Inventory" suffix). |
| Keep old column for compatibility? | No — **drop `inventoryAccount`** so TypeScript surfaces every stale reference. |

## Proposed Solution

### Classification resolver (one rule, three runtimes)

```
resolveInventoryAccount(replenishmentSystem, defaults) =
  replenishmentSystem === 'Buy' ? defaults.rawMaterialsAccount : defaults.finishedGoodsAccount
```

- **Edge functions (Deno)**: helper exported next to `getDefaultPostingGroup()` in `functions/shared/get-posting-group.ts`. Posting sites already fetch the item for `itemTrackingType`; add `replenishmentSystem` to those selects.
- **SQL functions**: inline `CASE WHEN i."replenishmentSystem" = 'Buy' THEN ad."rawMaterialsAccount" ELSE ad."finishedGoodsAccount" END` in `backflush_job_materials` and `complete_job_to_inventory`. `complete_job_to_inventory` uses the resolver too — a job producing a `Buy` item debits RM, consistent with where its later credits land.
- **EE Kysely (Xero inventory adjustments)**: join `item`, select the CASE as the resolved `inventoryAccount` field.

Unchanged branches: Non-Inventory → `indirectCostAccount`; outside processing → `workInProgressAccount`; all interim/accrual accounts.

### Posting matrix after the split

| Flow | Debit | Credit |
|---|---|---|
| Purchase receipt (Inventory item) | RM or FG by item rule | GR/NI |
| Purchase invoice (Inventory item, no receipt) | RM or FG by item rule | Payables |
| Material issue / backflush | WIP | RM or FG by consumed item (Make subassembly credits FG) |
| Job completion | RM or FG by job item (normally FG) | WIP |
| Shipment | COGS | RM or FG by shipped item |
| Sales invoice (no prior shipment) | COGS | RM or FG by invoiced item |

## Design Decisions

| Heuristic | Decision |
|---|---|
| Multi-tenancy | `accountDefault` is per-company; account seeding is per company group (existing pattern). All queries stay company-scoped. |
| Config shape | Flat defaults, no matrix config (posting groups stay dead). Classification is derived, not configured. |
| Backward compatibility | None kept — column dropped intentionally. Historical journal lines keep their accountIds (history is never rewritten). |
| Migration safety | Idempotent DDL, COALESCE backfills to NOT-NULL-safe fallback, column drop last. Functions forked from latest definitions with `DROP FUNCTION IF EXISTS` first, signatures preserved. |
| RLS / permissions | No new tables; existing `accountDefault` policies apply. |
| Service shape | `getDefaultAccounts` / `getDefaultPostingGroup` unchanged (`select("*")`). |
| Forms | `defaultBalanceSheetAccountValidator` swaps one required field for two; form section "Inventory" gains a second field. |

## Data Model Changes

```sql
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "rawMaterialsAccount" TEXT REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS "finishedGoodsAccount" TEXT REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- seed 1220 Finished Goods per company group (parent resolved by name, not number)
-- backfill: rawMaterialsAccount = inventoryAccount;
--           finishedGoodsAccount = COALESCE(<1220 id>, inventoryAccount)
-- SET NOT NULL on both
-- redefine backflush_job_materials + complete_job_to_inventory with CASE resolver
ALTER TABLE "accountDefault" DROP COLUMN IF EXISTS "inventoryAccount"; -- last
```

Seed (new companies): `1210` renamed **Raw Materials**, new **1220 Finished Goods** (parent `inventory` group); `accountDefaults` maps `rawMaterialsAccount: "1210"`, `finishedGoodsAccount: "1220"`. `seed-company` fallback map: `finishedGoodsAccount → rawMaterialsAccount`, `rawMaterialsAccount → workInProgressAccount`.

## Touched Surfaces

Edge functions `post-receipt`, `post-purchase-invoice`, `post-shipment`, `post-sales-invoice`, `issue` + shared helper; SQL `backflush_job_materials` (latest: `20260710044431`), `complete_job_to_inventory` (latest: `20260706182830`); `accounting.models.ts`; `AccountDefaultsForm.tsx`; EE Xero `inventory-adjustment.ts` + `core/models.ts`; seed files; generated types. `close-job` uses only WIP — untouched.

## Acceptance Criteria

1. `grep -rn "inventoryAccount"` over live TS/SQL (excluding generated types and historical migrations) → zero hits.
2. Migration is idempotent (re-runnable over committed partial state) and passes a rolled-back psql validation: columns NOT NULL and wired for every company, 1220 exists per group, both SQL functions reference the new columns, old column gone.
3. Receipt of a `Buy` item debits `rawMaterialsAccount`; job completion debits `finishedGoodsAccount`; material issue credits RM for `Buy` materials and FG for `Make` subassemblies; shipment/sales-invoice credit follows the shipped item's rule.
4. Account Defaults settings form shows and saves both fields.
5. Scoped typecheck (`erp`, `@carbon/ee`) and lint pass.
6. New-company seed produces a chart with 1210 Raw Materials / 1220 Finished Goods wired to the new defaults.

## Risks / Known Limitations

- **Deploy window**: between migration (column drop) and edge-function rollout, old posting code fails and Inngest retries self-heal. Drop is the last statement.
- **Pre-split FG stock**: shipping pre-existing manufactured stock credits FG while its value sits in the legacy account → FG negative until a manual reclass JE (accepted; documented in PR/release notes).
- **Reclassification drift**: changing `replenishmentSystem` on an item with on-hand value strands value in the old account (documented limitation, same class as costing-method changes).
- **QuickBooks branch**: unmerged PR #1129 touches EE accounting sync — expect a small conflict at merge time.

## Changelog

- 2026-07-13 — Spec written and approved (classification + migration strategy resolved with Brad).
- 2026-07-13 — Follow-up migration `20260713234852_rename-inventory-account-to-raw-materials.sql`: the original "leave existing account names untouched" decision left existing companies with an "Inventory" raw-materials account while new companies seed "Raw Materials" — an asymmetric, confusing chart. The follow-up renames the `rawMaterialsAccount`-designated "Inventory" account to "Raw Materials" (guarded + idempotent).
