# Task: Address CodeRabbit Review Feedback on PR #1157

**PR:** https://github.com/crbnos/carbon/pull/1157  
**Branch:** `fix/1156-fixed-asset-gaap-journals`  
**Base:** `main`  
**Worktree:** `/home/openclaw/carbon` (already on this branch)

## Context

PR #1157 adds GAAP-correct fixed-asset journal entries. CodeRabbit flagged 5 inline actionable issues (threads 1-5, Major/Critical) plus locale/glossary issues. Address all of them.

## Actionable Items (must fix)

### Thread 1 — PRRT_kwDOMEOB5M6Rg8aW [Major]
**File:** `apps/erp/app/modules/accounting/accounting.server.ts` lines 281-300  
**Issue:** Registration omits opening accumulated depreciation. Partially-depreciated assets produce a GL entry equal to gross cost while the subledger starts at NBV.  
**Fix:** Update `postAssetRegistration()` journal line creation to:
1. Debit `assetAccountId` for gross cost (existing)
2. Credit `accumulatedDepreciationAccountId` for any existing accumulated depreciation
3. Credit offset account only for NBV (gross cost - accumulated depreciation)
Also document the three-line opening entry in `.ai/rules/fixed-asset-lifecycle.md` around lines 101-108.

### Thread 2 — PRRT_kwDOMEOB5M6Rg8ae [Major]  
**Files:**
- `apps/erp/app/modules/accounting/accounting.server.ts` lines 332-344 — add `companyId` predicate to fixed-asset activation `updateTable("fixedAsset")` chain
- `packages/database/supabase/functions/post-sales-invoice/index.ts` lines 591-614 — add `companyId` predicates to both fixed-asset lookup and disposal lookup  
**Issue:** Missing cross-tenant isolation — assets activated/queried without companyId filter violates the "Never expose cross-tenant data" rule.

### Thread 3 — PRRT_kwDOMEOB5M6Rg8aj [Critical]  
**File:** `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` around line 69  
**Issue:** If `getCompanySettings()` returns an error, code falls through and treats accounting as disabled, potentially activating an accounting-enabled asset without its capitalization journal.  
**Fix:** Add early return on `companySettings.error`:
```typescript
if (companySettings.error) {
  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(
      request,
      error(companySettings.error, "Failed to get company settings")
    )
  );
}
```
Only derive `accountingEnabled` from successfully-loaded settings.

### Thread 4 — PRRT_kwDOMEOB5M6Rg8ar [Major]  
**File:** `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` around line 89  
**Issue:** `dimensionsResult.error` is ignored; absent identifiers can produce a registration journal without required location and asset-class dimensions.  
**Fix:** Add guard after dimension resolution:
```typescript
if (dimensionsResult.error) {
  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(
      request,
      error(dimensionsResult.error, "Failed to get accounting dimensions")
    )
  );
}
```

### Thread 5 — PRRT_kwDOMEOB5M6Rg8aw [Major]  
**File:** `packages/database/supabase/functions/post-sales-invoice/index.ts` around line 620  
**Issue:** When no `fixedAssetDisposal` record is found, code falls back to `nbv = saleProceeds`, suppressing gain/loss and potentially leaving clearing account with outstanding balance.  
**Fix:** Abort invoice posting if no valid disposal record is found rather than falling back to `saleProceeds`. Return an error that propagates clearly.

## Locale / Glossary Issues (also fix)

### Thread 6 — terms.ts glossary [Minor]
**File:** `packages/glossary/src/terms.ts` around line 416  
Keep glossary definitions to one crisp sentence. Move extended lifecycle/explanatory details into the existing `href` targets.

### Threads 7-19 — Locale translations [Minor]
Fix in all applicable locale `.po` files:

**Empty msgstr (add translations):** de, es, fr, hi, it, ja, ko, pl, pt, ru, tr, zh — add translations for new fixed-asset accounting entries (asset account, accumulated depreciation, impairment, disposal gain/loss, retirement lifecycle, disposal clearing account).

**Shifted/misaligned msgstr (correct alignment):**
- `es/erp.po` ~L5607-5624: msgstr values are shifted/semantically corrupted — realign bank-charge, interest, purchase-tax, reverse-charge, tax-timing entries
- `fr/erp.po` ~L5609-5612, L5624-5626: bank-service-charge and inventory-count variance misaligned
- `de/erp.po` ~L5610-5612: bank-service-charge and inventory-count descriptions using wrong translations
- `zh/erp.po` ~L5607-5612, L5622-5627: bank-service-charge, tax-timing, physical-count shifted
- `hi/erp.po` ~L5607-5612, L5622-5627: similar misalignment
- `it/erp.po` ~L5607-5612, L5622-5627: bank-charge and physical-inventory entries using interest/intercompany translations
- `ja/erp.po` ~L5607-5611, L5625-5639: acquisition and bank-service-charge misaligned; physical-count vs source-company shifts
- `pl/erp.po` ~L5607-5612, L5622-5627: bank charges translated as interest, acquisition omits "purchase or capitalized cost"
- `pt/erp.po` ~L5607-5624: msgstr values offset from msgid
- `ru/erp.po` ~L5607-5608: acquisition translation omits "purchase or capitalized cost"; ~L11680-11681: disposal-clearing account description wrong
- `tr/erp.po` ~L5607-5608, L5625-5626: acquisition and inventory-variance descriptions stale

## Acceptance Criteria

After changes:
1. `postAssetRegistration()` handles partially-depreciated assets with a 3-line entry (Dr asset / Cr accum depr / Cr offset for NBV)
2. Fixed-asset activation and invoice disposal lookups include `companyId` filter
3. Settings lookup failure throws/redirects rather than silently falling through
4. Dimension resolution failure throws/redirects before reaching `postAssetRegistration`
5. Invoice posting aborts if no disposal record found (no fallback to `saleProceeds`)
6. All locale .po files have accurate translations for new fixed-asset entries (no empty msgstr)
7. All shifted locale msgstr values are realigned with their msgid
8. Tests pass: `pnpm test` in root

## Working Directory

The branch `fix/1156-fixed-asset-gaap-journals` is checked out at `/home/openclaw/carbon`. 

Work in `/home/openclaw/carbon`. When done, commit with a clear message and push. Do NOT create a new PR — push to the existing branch; PR #1157 will auto-update.

Commit message format: `fix(accounting): address CR review feedback — accum-depr, companyId scoping, error guards, locale fixes`
