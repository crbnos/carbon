# Task: PR #1157 — CodeRabbit Round 4 Feedback

## Context
PR #1157: `fix(accounting): GAAP-correct journal entries for fixed asset registration and sale/disposal`
Branch: `fix/1156-fixed-asset-gaap-journals`
Working directory: `/home/openclaw/carbon` (already on the right branch)
Latest commit: `3da44d0a9`

## Objective
Address all 17 unresolved CodeRabbit round-4 threads. Push a single clean commit on the same branch.

---

## Items to Fix

### 1. `register.tsx` — Reject dimensionsResult.error and validate required dimensions (Major)
**File:** `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` around lines 99 and 132–150
**Issue:** `dimensionsResult.error` is ignored; absent identifiers are passed into `postAssetRegistration`, which can produce a registration journal without required location/asset-class dimensions.
**Fix:**
```diff
+if (dimensionsResult.error) {
+  throw redirect(
+    path.to.fixedAsset(fixedAssetId),
+    await flash(
+      request,
+      error(dimensionsResult.error, "Failed to get accounting dimensions")
+    )
+  );
+}
+
 const locationDimensionId = (dimensionsResult.data ?? []).find(
   (d) => d.entityType === "Location"
 )?.id;
 const assetClassDimensionId = (dimensionsResult.data ?? []).find(
   (d) => d.entityType === "FixedAssetClass"
 )?.id;
+
+if (!locationDimensionId || !assetClassDimensionId) {
+  throw redirect(
+    path.to.fixedAsset(fixedAssetId),
+    await flash(
+      request,
+      error(null, "Missing dimensions required for asset registration")
+    )
+  );
+}
```
Check that `dimensionsResult` fetch happens before these guards and that the function signatures match; verify `path.to.fixedAsset`, `flash`, and `error` are imported/used consistently elsewhere in this route.

### 2. `ru/erp.po` — Correct and translate disposal-clearing account definition (Major)
**File:** `packages/locale/locales/ru/erp.po` around line 11680–11681
**Issue:** The disposal-clearing account description has an empty `msgstr` AND the English description contradicts itself (should say invoicing credits NBV — not sale proceeds — so the account nets to zero). The msgid itself must be corrected if it's wrong, and a correct Russian translation must be provided.
**Fix:**
- Ensure the `msgid` says: invoicing credits the clearing account by the asset's **net book value** (not sale proceeds), consistent with: shipment debits NBV, invoicing credits NBV, gain/loss goes to Disposal Account separately. This nets the clearing account to zero.
- Add an accurate Russian `msgstr`. Look at nearby Russian translations for style reference.
- If the msgid has already been corrected in a prior commit and only the msgstr is empty, just fill in the translation.

### 3. `de/erp.po` — Use disposal-neutral German terminology (Minor)
**File:** `packages/locale/locales/de/erp.po` at lines 5590, 5602, 5640–5641, 9961–9962
**Issue:** `disposed` is translated as `veräußert` or paired with `verkauft`, narrowing the meaning to sale only. The catalog already uses `Entsorgt` for `Disposed` elsewhere.
**Fix:** Replace sale-specific wording with disposal-neutral terms that cover both scrapping and sale. Use `entsorgt`/`Entsorgung` or equivalent consistent with the rest of the catalog.

### 4. `de/erp.po` — Correct reverse-charge translation (Minor)
**File:** `packages/locale/locales/de/erp.po` at line 5620
**Issue:** `selbst bewertet` does not convey tax self-assessment.
**Fix:** Change to wording like `wenn der Käufer die Steuer selbst berechnet` or the project's canonical German VAT phrasing. Check other German VAT-related translations in the same file for canonical phrasing.

### 5. `de/erp.po` — Translate "intercompany" as "konzernintern" (Minor)
**File:** `packages/locale/locales/de/erp.po` at lines 5629 and 5632
**Issue:** `konzernweit` means group-wide, not intercompany transaction between entities.
**Fix:** Replace `konzernweit` with `konzernintern` in both entries.

### 6. `it/erp.po` — Preserve Accounts Payable meaning (Minor)
**File:** `packages/locale/locales/it/erp.po` at line 5593
**Issue:** `saldo PA` is ambiguous — can be read as "public administration."
**Fix:** Change to `saldo dei debiti verso fornitori` or keep `saldo AP`:
```diff
-msgstr "Conto GL accreditato quando una fattura fornitore viene registrata (saldo PA)."
+msgstr "Conto GL accreditato quando una fattura fornitore viene registrata (saldo dei debiti verso fornitori)."
```

### 7. `it/erp.po` — Translate "Disposed" as status covering sale and scrapping (Minor)
**File:** `packages/locale/locales/it/erp.po` at line 9962
**Issue:** `Ceduto` implies transfer/sale; the canonical term covers both sale and scrapping.
**Fix:**
```diff
-...impostando il suo stato su Ceduto.
+...impostando il suo stato su Dismesso.
```

### 8. `ko/erp.po` — Use 순장부가액 consistently for "net book value" (Minor)
**File:** `packages/locale/locales/ko/erp.po` at lines 5679–5680, 9961–9962, 11692–11693
**Issue:** `순장부가치` is used instead of the glossary term `순장부가액`.
**Fix:** Replace all three occurrences of `순장부가치` with `순장부가액`.

### 9. `pl/erp.po` — Fix "applied overhead" translation (Minor)
**File:** `packages/locale/locales/pl/erp.po` at line 5578
**Issue:** `narzuconymi` means "imposed" not "applied overhead."
**Fix:**
```diff
-msgstr "Konto GL przechwytujące różnice między narzuconymi i rzeczywistymi kosztami wytwarzania."
+msgstr "Konto GL przechwytujące różnice między zastosowanymi a rzeczywistymi kosztami ogólnymi produkcji."
```

### 10. `pl/erp.po` — Preserve sale-versus-scrap meaning for "disposed" (Minor)
**File:** `packages/locale/locales/pl/erp.po` at line 5590
**Issue:** `likwidacji` narrows to liquidation/scrapping only.
**Fix:**
```diff
-msgstr "Konto GL uznawane w celu usunięcia pierwotnego kosztu zasobu w momencie jego likwidacji."
+msgstr "Konto GL uznawane w celu usunięcia pierwotnego kosztu środka trwałego przy jego zbyciu."
```

### 11. `pl/erp.po` — Translate "tax accrued" correctly (Minor)
**File:** `packages/locale/locales/pl/erp.po` at line 5620
**Issue:** `podatki szacunkowe` means "estimated taxes," not "tax accrued."
**Fix:**
```diff
-msgstr "Konto GL dla podatków szacunkowych zgodnie z zasadami odwrotnego obciążenia, gdzie nabywca dokonuje samooceny."
+msgstr "Konto GL dla podatku naliczonego zgodnie z zasadami odwrotnego obciążenia, gdy nabywca rozlicza go samodzielnie."
```

### 12. `pl/erp.po` — Use standard Polish for "contra-asset account" (Minor)
**File:** `packages/locale/locales/pl/erp.po` at line 5665
**Issue:** `aktywa przeciwne` is not a recognized Polish accounting term.
**Fix:**
```diff
-msgstr "Konto GL aktywów przeciwnych, uznawane w miarę księgowania amortyzacji w każdym okresie i obciążane w pełnej wysokości, gdy środek trwały zostaje sprzedany lub zezłomowany."
+msgstr "Konto GL korygujące aktywa, uznawane w miarę księgowania amortyzacji w każdym okresie i obciążane w pełnej wysokości, gdy środek trwały zostaje sprzedany lub zezłomowany."
```

### 13. `pt/erp.po` — Align disposal translations with canonical lifecycle terminology (Minor)
**File:** `packages/locale/locales/pt/erp.po` at lines 5589–5590 and 5601–5602
**Issue:** `descartado` narrows "disposed" to scrapping only.
**Fix:** Use `alienação`/`alienado` for both entries to cover sale and scrapping. The account at L5590 clears the original cost; the account at L5601–5602 clears accumulated depreciation. Update both to use disposal-neutral `alienação`/`alienado`.

### 14. `pt/erp.po` — Avoid implying cash receipt at invoicing (Minor)
**File:** `packages/locale/locales/pt/erp.po` at line 11694
**Issue:** `valor recebido` implies payment already collected.
**Fix:**
```diff
-msgstr "Conta de compensação temporária de alienação, debitada pelo valor contábil líquido do ativo no envio e creditada pelo valor recebido no faturamento, zerando ao final do ciclo de venda."
+msgstr "Conta de compensação temporária de alienação, debitada pelo valor contábil líquido do ativo no envio e creditada pelo valor faturado, zerando ao final do ciclo de venda."
```

### 15. `tr/erp.po` — Preserve "overhead" distinction (Major)
**File:** `packages/locale/locales/tr/erp.po` at lines 5577–5578
**Issue:** `üretim maliyetleri` means manufacturing costs, not manufacturing overhead.
**Fix:** Change to `üretim genel giderleri` for manufacturing overhead, preserving the rest of the msgstr.

### 16. `tr/erp.po` — Use correct Turkish for accounting "posted" (Major)
**File:** `packages/locale/locales/tr/erp.po` at lines 5592–5593 and 5604–5605
**Issue:** `gönderildi` means "sent" and misleads about when the GL event occurs.
**Fix:**
- L5592–5593: Use `tedarikçi faturası muhasebeleştirildiğinde` (when supplier invoice is posted/recorded)
- L5604–5605: Use `müşteri faturası muhasebeleştirildiğinde` (when customer invoice is posted/recorded)

### 17. `tr/erp.po` — Use standard Turkish for "clearing account" (Minor)
**File:** `packages/locale/locales/tr/erp.po` at lines 11692–11694
**Issue:** `elden çıkarma-arınma` is not an established accounting term.
**Fix:** Change to `geçici elden çıkarma mahsup hesabı`, retaining the shipment/invoicing debit-credit behavior description.

---

## Implementation Notes
- For each locale file, look at the exact current msgstr before editing — the proposed diffs are based on prior commits; the actual current text may differ slightly. Ground each fix in the real file content.
- For `register.tsx` item 1: check the exact import signatures for `flash`, `error`, `redirect`, and `path.to.fixedAsset`. The fix should match how other route error paths in the file are written (probably `return redirect(...)` not `throw redirect(...)` depending on Remix version).
- For the `ru/erp.po` item 2: if the msgid is already correct (describes NBV credit), just fill in the msgstr. If it still says "sale proceeds," fix both.

---

## Verification
After implementing:
1. Run `pnpm --filter @carbon/erp typecheck` to confirm no TypeScript errors from the register.tsx change
2. Spot-check 3–4 locale files in the diff to confirm msgid/msgstr alignment is intact
3. Confirm no other non-targeted locale lines were accidentally changed

## Commit
Push one commit on the existing branch:
```
git add -A
git commit -m "fix(accounting): address CodeRabbit round-4 review feedback on PR #1157"
git push origin fix/1156-fixed-asset-gaap-journals
```

## Output
Write a brief summary of what was done to:
`/home/openclaw/.openclaw/workspace/loop-runs/1157-review-feedback-4.log`
