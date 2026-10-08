# Fixed asset cost adjustment (zero-cost capitalization)

A serialized unit made by a job with no production events or material issues,
or issued into stock at no cost, carries 0 in inventory. Capitalizing it from
stock is refused ("has no cost in inventory"), and Make to Asset creates the
asset at 0 with nothing to correct it. Decisions (user, 2026-10-08):

- Offset account: user picks, defaults to Retained Earnings.
- Entry points: both — the capitalize form takes a cost when the unit carries
  none, and the asset page gets **Adjust Cost**.
- Direction: raise only.
- Depreciation: missed Straight Line months catch up in the next run.

## Tasks

- [x] Migration `20261008163615_fixed-asset-cost-adjustment.sql`: enum values
      `fixedAssetTransferType 'Cost Adjustment'`, `fixedAssetTransferSourceType 'Manual'`;
      `pnpm db:migrate` + `pnpm run generate:types`.
- [x] `post-asset-transfer/validators.ts`: `capitalize` gains `cost?` +
      `offsetAccountId?`; new `adjustCost` variant; pure helpers
      `resolveCapitalizationCost`, `statusAfterCostAdjustment`; tests.
- [x] `post-asset-transfer/index.ts`: entered cost on capitalize (only when the
      unit carries 0; Cr offset account); `adjustCost` (Active / Fully
      Depreciated; Dr class asset / Cr offset; Fully Depreciated → Active when
      NBV is above residual); DB tests.
- [x] Depreciation: `buildDepreciationLines` adds the Straight Line shortfall
      (book and tax) to the first month of an asset with a posted Cost
      Adjustment; `buildDepreciationRunLines` passes the flag; utils tests.
- [x] ERP: validators, capitalize route/form (cost + offset account when cost
      is 0), `$fixedAssetId.adjust-cost.tsx` + `FixedAssetAdjustCostForm`, path,
      header menu item.
- [x] Docs: `.claude/rules/fixed-asset-lifecycle.md`, docs reference page.
- [x] Verify: server-functions + erp typecheck, tests, Biome.
