# Plan: Raw Materials / Finished Goods Inventory Account Split

Spec: `.ai/specs/2026-07-13-raw-materials-finished-goods-accounts.md`

## Progress

- [x] Spec approved (classification rule + migration strategy resolved with Brad)
- [x] Migration `20260713190909_raw-materials-finished-goods-accounts.sql` (columns → 1220 per company group → backfill → NOT NULL → forked `backflush_job_materials` + `complete_job_to_inventory` → drop `inventoryAccount` last). Fork fidelity proven by diff against source definitions; idempotent re-run and legacy-state simulation both pass in rolled-back txns.
- [x] Seed files: `seed.data.ts` (1210 → Raw Materials, added 1220 Finished Goods, remapped `accountDefaults`), `seed-company/index.ts` fallbacks (RM→WIP, FG→RM), `seed-dev.ts` verified zero-change (derives from `accountDefaults`)
- [x] Migration applied locally (via crbn up) + `pnpm run generate:types` (diff also picks up periodCloseTask/periodCloseTaskDefinition drift from merged #1134 — legitimate fix)
- [x] `resolveInventoryAccount` in `functions/shared/get-posting-group.ts` + all 5 edge functions updated (incl. post-receipt Inbound Transfer branch and the `createMaterialWipEntries` helper + 4 call sites in `issue`)
- [x] ERP: `accounting.models.ts` validator + `AccountDefaultsForm.tsx` (two fields, new glossary termIds)
- [x] EE: Xero `inventory-adjustment.ts` resolves per item; `core/models.ts` comment updated
- [x] Glossary: `account-default-inventory` replaced with `account-default-raw-materials` + `account-default-finished-goods`; i18n catalogs extracted + 96 translations filled (linguito check clean); docs site had no stale references
- [x] Verification: zero live `inventoryAccount` hits; typecheck green (erp, @carbon/ee, @carbon/database, @carbon/glossary); biome zero errors; deno check at 252-error baseline parity; SQL fixture test (rolled back) proves backflush credits RM 1210 / completion debits FG 1220; browser e2e proves Account Defaults form renders+saves and a posted PO receipt debits 1210 Raw Materials (JE-2026-07-000001)

## Follow-up fix (same branch, 2026-07-13)

- [x] "Inventory Shipped Not Invoiced" default rendered blank on the Account Defaults page: it was seeded as a **liability** (2130) while the field filters options to class Asset — and no posting code has ever written to it (post-shipment posts COGS/inventory directly). **Removed entirely** per Brad: `20260713214441_remove-inventory-shipped-not-invoiced-account.sql` drops the `accountDefault."inventoryShippedNotInvoicedAccount"` column and deletes the seeded account wherever it has no journal history (per-row FK-violation guard leaves custom-referenced rows in the chart). Also removed: the seed chart entry + `accountDefaults` mapping, the validator field, the form field, and the glossary term; types/swagger regenerated; i18n catalogs pruned. An earlier reclass-to-asset migration (20260713204033) was superseded and deleted before ever being committed. If a shipped-not-invoiced accrual flow is ever built, the account + column come back with the feature.

## Follow-up fix 2 (same branch, 2026-07-13): overhead absorption in the job-completion catch-up

- [x] Jobs completed with unposted production events got labor absorption but **no overhead absorption** (user-reported on JE-2026-07-000003). PR #1127 added overhead (DR WIP / CR Overhead Absorption at workCenter.overheadRate × duration) only to the `post-production-event` edge function; `complete_job_to_inventory`'s catch-up loop for `postedToGL = false` events never learned it, silently understating WIP and Finished Goods. Fixed forward in `20260713222236_fix-job-completion-overhead-absorption.sql` (new migration — applied migrations are never edited): the loop reads `overheadRate`, posts the mirrored overhead pair gated on cost > 0 + account configured, and switches event lines to per-event `production-event:<id>` references so post-production-event can attribute/reverse them. Proven in a rolled-back fixture test: 0.6h at labor 50/overhead 100 → WIP +30/+60, absorption −30/−60, FG debit 140 includes overhead. Pre-existing events posted under the old scheme (e.g. J000001's 0.31 of overhead) are not retro-posted.

## Not e2e-exercised (verified by typecheck + identity to the proven pattern)

- `post-shipment` / `post-sales-invoice` credit side and `issue` edge-fn runtime — same shared resolver + item-select pattern proven live in `post-receipt`; deno-check parity confirms no new type errors at those call sites.

## Notes

- Never edit historical migrations; fork latest function definitions (`20260710044431` backflush, `20260706182830` complete_job_to_inventory) with `DROP FUNCTION IF EXISTS`, preserving signatures.
- Migration filename: randomized HHMMSS (never 000000).
- No commits unless Brad asks.
