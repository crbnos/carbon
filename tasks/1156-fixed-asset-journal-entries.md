# Task Brief — Issue #1156: GAAP-correct journal entries for fixed asset registration, purchase, and sale/disposal

**Date:** 2026-07-16  
**Branch:** loop/1156  
**Prereq PR:** #1155 (merged 2026-07-16T14:40:49Z — `methodType` fix is on main)  
**Research report:** `/home/openclaw/.openclaw/workspace/tasks/fixed-asset-journal-entries-report.md`

---

## Objective

Fix three accounting gaps in Carbon's fixed-asset GL posting so the books are GAAP-correct:

1. **Manual registration** must post an acquisition journal entry (Dr Fixed Asset / Cr acquisition-source account)
2. **Gain/Loss on disposal** must use `disposalAccountId`, not `writeOffAccountId`
3. **Shipment-before-invoice** must hold NBV in a Disposal Clearing account so no P&L mis-statement occurs between shipment and invoicing

Acceptance criteria (all must be met or explicitly noted as `unverified`):

### AC1 — Manual registration posts acquisition JE
- Route: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` (the manual register action)
- When user submits the registration form, a journal entry is created: `Dr fixedAssetClass.assetAccountId / Cr [acquisitionSourceAccountId or configurable source]`
- If no acquisition-source account exists in the schema, use `Cr Paid-in Capital` or the nearest sensible default — document the choice in a code comment
- A fixed asset that was registered manually must not exist on the books without a corresponding GL entry

### AC2 — Disposal gain/loss uses `disposalAccountId`
- `packages/database/supabase/functions/post-shipment/index.ts` (~L548–697): at shipment, write NBV into a **Disposal Clearing** account (balance-sheet holding), not `writeOffAccountId`
- `packages/database/supabase/functions/post-sales-invoice/index.ts` (~L571–860): at invoice post, debit Disposal Clearing and credit `disposalAccountId` for the net gain/loss (proceeds − NBV), explicit separate line
- `apps/erp/app/modules/accounting/accounting.server.ts:postDisposal()` (L37, the scrap path): same fix — use `disposalAccountId` not `writeOffAccountId` for the gain/loss line
- `writeOffAccountId` must net to zero after a completed disposal

### AC3 — No interim full-loss mis-statement
- A shipped-but-not-yet-invoiced asset must NOT show a full loss in P&L
- The NBV sits in Disposal Clearing (balance sheet) until the invoice posts
- After invoice: Disposal Clearing drains; Gain/Loss lands on `disposalAccountId` in P&L

### AC4 (stretch) — Depreciation catch-up warning
- If an asset being disposed has un-posted depreciation periods before the disposal date, surface a non-blocking warning (UI or server log is fine — it does NOT need to block the disposal)
- This is stretch: implement if it fits cleanly in the same files; skip and note as `unverified` otherwise

### GL rule update
- After implementation, update `.ai/rules/fixed-asset-lifecycle.md` to document the corrected posting pattern

---

## Files to Touch (from issue body)

| File | Change |
|---|---|
| `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` | Add acquisition JE on manual register action |
| `packages/database/supabase/functions/post-shipment/index.ts` | Swap writeOff → Disposal Clearing at shipment |
| `packages/database/supabase/functions/post-sales-invoice/index.ts` | Disposal Clearing → disposalAccountId + explicit gain/loss at invoice |
| `apps/erp/app/modules/accounting/accounting.server.ts` | Fix `postDisposal()` scrap path |
| `.ai/rules/fixed-asset-lifecycle.md` | Update with corrected GL patterns |

Reference for GL posting pattern: `packages/database/supabase/functions/shared/post-adjustment.ts`  
Reference migration: `20260524143827_fixed-assets.sql`, `20260524143826_fixed-asset-enums.sql`

---

## Conductor Binding (synthesize before dispatching inner loop)

**kind:** fix  
**risk:** medium (accounting logic, no schema changes expected)  
**acceptance:** the 4 ACs above  
**issue:** 1156  
**notes:**
- Run `pnpm run generate:types` AFTER any schema migration changes (there may be none here)
- Behavior gate: write a unit test OR provide CLI proof via Supabase function call showing the correct JEs
- Use `post-adjustment.ts` as the posting helper template
- Do NOT touch depreciation scheduling (out of scope)
- Do NOT change `methodType` validation (already fixed in #1155 / main)

---

## Dispatch Instructions

You are Claude Code operating as the inner-loop builder. Your job:

1. Read the research report at `/home/openclaw/.openclaw/workspace/tasks/fixed-asset-journal-entries-report.md` for full context
2. Check out the worktree at `/home/openclaw/carbon-loop-1156` (created by outer loop)
3. Synthesize a proper binding and write it to `/home/openclaw/carbon/.ai/runs/1156/binding.loop.md`
4. Implement the changes per the acceptance criteria
5. Run lint + typecheck + any unit tests you write
6. Push the branch and open PR targeting `main`
7. Write outcome to `/home/openclaw/carbon/.ai/runs/1156/outcome.json`

The harness command will be:
```bash
pnpm --filter @carbon/harness loop /home/openclaw/carbon/.ai/runs/1156/binding.loop.md --cwd /home/openclaw/carbon-loop-1156
```

Budget: $10 (medium feature, multiple files touched)
