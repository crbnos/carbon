---
id: "1156"
issue: 1156
kind: bug
risk: med
title: "GAAP-correct journal entries for fixed asset registration, purchase, and sale/disposal"
acceptance:
  - "Manual register action posts acquisition JE: Dr fixedAssetClass.assetAccountId / Cr [acquisitionSourceAccount]"
  - "Disposal shipment posts NBV to Disposal Clearing (balance sheet), NOT writeOffAccountId"
  - "Disposal invoice drains Disposal Clearing and routes net gain/loss to fixedAssetClass.disposalAccountId"
  - "writeOffAccountId nets to zero after a completed disposal"
  - "A shipped-but-uninvoiced asset shows ZERO P&L impact (only balance sheet)"
  - "Unit test or CLI/DB proof: manual register produces JE row with correct debit/credit accounts"
  - "Unit test or CLI/DB proof: disposal invoice post shows disposalAccountId carries gain/loss, writeOffAccountId = 0 net"
  - ".ai/rules/fixed-asset-lifecycle.md updated with corrected posting patterns"
  - "TypeScript clean on affected packages"
  - "Biome lint clean on affected packages"
---

## Context

Carbon's fixed-asset GL posting has three GAAP gaps. PR #1155 (merged today) fixed `methodType` validation — that is out of scope here. The research report at `/home/openclaw/.openclaw/workspace/tasks/fixed-asset-journal-entries-report.md` covers the full accounting analysis.

Key schema facts (from `20260524143827_fixed-assets.sql`):
- `fixedAssetClass` has columns: `assetAccountId`, `accumulatedDepreciationAccountId`, `depreciationExpenseAccountId`, `writeOffAccountId`, `writeDownAccountId`, `disposalAccountId`
- `disposalAccountId` and `writeDownAccountId` exist but are **never used** in any posting path currently
- `writeOffAccountId` is incorrectly used for both the NBV removal AND the gain/loss

## Acceptance Criteria

### AC1 — Manual registration posts acquisition journal entry
- File: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx`
- The manual `register` action must call a posting helper that creates:
  `Dr fixedAssetClass.assetAccountId / Cr [acquisitionSourceAccount]`
- If the schema has no dedicated "acquisition source" account on `fixedAssetClass`, use a reasonable default (e.g., a config account or `writeOffAccountId` as a transit). Document the choice in comments.
- No manually-registered asset should exist without a GL entry

### AC2 — Disposal uses `disposalAccountId` for gain/loss
- `packages/database/supabase/functions/post-shipment/index.ts`: at shipment, post NBV into **Disposal Clearing** (balance-sheet holding account), NOT `writeOffAccountId`
- `packages/database/supabase/functions/post-sales-invoice/index.ts`: at invoice, drain Disposal Clearing and route net gain/loss to `fixedAssetClass.disposalAccountId`
- `apps/erp/app/modules/accounting/accounting.server.ts` (scrap `postDisposal()`): same — use `disposalAccountId` for gain/loss
- `writeOffAccountId` nets to zero after a completed disposal

### AC3 — No interim P&L mis-statement
- Shipment: NBV goes to Disposal Clearing (balance sheet, not P&L)
- Invoice: Disposal Clearing drains; gain/loss lands on `disposalAccountId`
- A shipped-but-uninvoiced asset shows ZERO P&L impact (only balance sheet)

### AC4 (stretch) — Depreciation catch-up warning
- If asset has un-posted depreciation periods before disposal date, surface a non-blocking warning
- Skip if scope is too large; mark as `unverified` in outcome

### AC5 — GL rules updated
- `.ai/rules/fixed-asset-lifecycle.md` updated with corrected posting patterns

## Behavior Gate

Write a unit test OR provide CLI/DB proof showing:
1. Manual register → JE row exists with correct debit/credit accounts
2. Disposal invoice post → `disposalAccountId` carries the gain/loss, `writeOffAccountId` = 0 net

Use the simplest sufficient proof. Unit test preferred. Visual verification acceptable if the UI path is the only feasible path.

## Posting Pattern Reference

Use `packages/database/supabase/functions/shared/post-adjustment.ts` as the GL posting helper template.

## Out of Scope
- Depreciation scheduling / Inngest cron
- `methodType` validation (fixed in #1155, on main)
- Schema migrations (no new columns needed — `disposalAccountId` already exists)

## Budget
$10 (medium, multiple files)
