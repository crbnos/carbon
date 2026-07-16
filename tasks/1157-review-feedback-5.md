# Task: Address CodeRabbit Round-5 Review Feedback — PR #1157

## Context
PR #1157 (`fix/1156-fixed-asset-gaap-journals`) is open on `crbnos/carbon`.
The main repo at `/home/openclaw/carbon` is already checked out on branch `fix/1156-fixed-asset-gaap-journals`.
This is Round-5 of CodeRabbit locale translation feedback (review posted 2026-07-16T17:17:49Z).

## Objective
Apply all 15 actionable translation fixes from CodeRabbit Round-5, commit, and push.

## Steps

1. `cd /home/openclaw/carbon`
2. `git fetch origin && git merge origin/fix/1156-fixed-asset-gaap-journals` (sync with any remote commits)
3. Apply each fix below to the specified file and line. For each, verify the msgid/msgstr structure is preserved (equal add/del lines per file in `git diff --numstat`).
4. After all edits: run `pnpm --filter @carbon/erp typecheck` and `pnpm --filter @carbon/glossary typecheck` — both must PASS.
5. `git add packages/locale/` && `git commit -m "fix(locale): address CodeRabbit round-5 review feedback on PR #1157"`
6. `git push origin fix/1156-fixed-asset-gaap-journals`
7. Use `gh api` to resolve each review thread listed in the Acceptance section.

## Fixes Required

### de/erp.po

**Line ~5629 — "intercompany" terminology**
Find the msgstr(s) near line 5629 that use "konzernweit" for "intercompany".
Replace "konzernweit" → "konzernintern" at both referenced entries (there may be two occurrences near that line). Preserve the rest of each translation unchanged.

**Line ~5620 — reverse-charge tax description**
Find the msgstr near line 5620 for the reverse-charge GL account description.
Replace "selbst bewertet" with canonical German VAT terminology for the buyer calculating/assessing the tax themselves — use "selbst berechnet" or "eigenständig ermittelt" (whichever fits the sentence grammatically).

**Line ~5590 — disposal terminology**
Find the msgstr(s) near line 5590 for the asset disposal description that use sale-specific wording ("veräußert" or "verkauft").
Replace with disposal-neutral wording covering both scrapping and sale — use "entsorgt oder veräußert" or simply "entsorgt" consistent with the catalog's existing "Entsorgt" translation for "Disposed." Preserve the original accounting meaning.

### it/erp.po

**Lines ~5592-5593 — AP balance**
Find the msgstr for "GL account credited when a supplier invoice is posted (AP balance)."
Replace "saldo PA" (if present) with "saldo dei debiti verso fornitori" to preserve the Accounts Payable meaning. (If the prior round already changed this correctly, verify and skip.)

**Lines ~9961-9962 — asset retirement "Disposed"**
Find the msgstr for the asset retirement description containing "Ceduto".
Replace "Ceduto" → "Dismesso" while preserving the rest of the translation.

### ko/erp.po

**Lines ~5679-5680 and ~9961-9962 and ~11692-11693 — net book value**
Find all three occurrences of "순장부가치" in these line ranges.
Replace each → "순장부가액" (the glossary term).
On line 11693 (debit side), also fix the Korean object particle: "순장부가액" ends in a consonant (액), so the particle should be "을" not "를". Verify the surrounding text and apply the correct particle.

### pl/erp.po

**Line ~5578 — applied overhead**
Find the msgstr for the "applied overhead" GL account description.
Replace the word(s) meaning "imposed/allocated" (e.g. "narzucone") → "zastosowane" (accounting term for "applied"). Preserve the rest of the sentence.

**Line ~5590 — disposal terminology**
Find the msgstr for the fixed-asset disposal entry.
Replace "likwidacji" → "zbyciu" to use the broader disposal term covering both sale and scrapping, matching the glossary.

**Line ~5620 — tax accrued (reverse-charge)**
Find the msgstr for the reverse-charge GL account description.
Replace "podatki szacunkowe" (or similar) → "podatek naliczony" for "tax accrued". Preserve the rest of the accounting meaning.

**Line ~5665 — contra-asset**
Find the msgstr for the contra-asset account entry.
Replace "aktywów przeciwnych" (or "opposite assets" wording) → standard accounting term "aktywów korygujących" or "konta korygującego aktywa" describing an account that reduces/adjusts asset balances. Preserve the depreciation and disposal context.

### pt/erp.po

**Lines ~5589-5590 and ~5601-5602 — disposal terminology**
Find the msgstr entries for asset disposal descriptions using "descartado" or "descarte".
Replace with canonical "alienação"/"alienado" terminology covering both sale and scrapping. Apply consistently to both the original-cost message and the accumulated-depreciation message at both line pairs.

**Lines ~11692-11694 — temporary disposal-clearing account**
Find the msgstr for the temporary disposal-clearing account where "valor recebido" appears.
Replace "valor recebido" with wording meaning "invoiced sales value" / "valor faturado" to accurately represent invoiced proceeds rather than money received. Preserve the debit, credit, and netting-to-zero meanings.

### tr/erp.po

**Lines ~5592-5593 — supplier invoice terminology**
Find the msgstr entries near 5592-5593 for the supplier invoice posted description.
Replace "gönderildiğinde" (sent) → "muhasebeleştirildiğinde" (posted/recorded).

**Lines ~5604-5605 — customer invoice terminology**
Find the msgstr entries near 5604-5605 for the customer invoice posted description.
Apply the same terminology change: "gönderildiğinde" → "muhasebeleştirildiğinde".

**Lines ~11692-11694 — temporary disposal-clearing account**
Find the msgstr for the Turkish temporary disposal-clearing account.
Replace with "geçici elden çıkarma mahsup hesabı" while preserving the existing shipment debit, invoicing credit, and net-to-zero meaning.

**Lines ~5577-5578 — manufacturing overhead**
Find the msgstr for the GL account description where "üretim maliyetleri" is used for "manufacturing overhead".
Replace "üretim maliyetleri" → "üretim genel giderleri". Preserve the rest of the meaning.

## Acceptance

After pushing, mark as resolved the following CodeRabbit review threads on PR #1157 (use `gh api` to resolve them, or they'll auto-resolve on the next CR scan):
- de: intercompany terminology (konzernweit → konzernintern)
- de: reverse-charge tax description (selbst bewertet)
- de: disposal terminology (veräußert/verkauft → neutral)
- it: AP balance (saldo PA → saldo dei debiti verso fornitori)
- it: Disposed status (Ceduto → Dismesso)
- ko: net book value (순장부가치 → 순장부가액, 3 occurrences + particle fix)
- pl: applied overhead (narzucone → zastosowane)
- pl: disposal terminology (likwidacji → zbyciu)
- pl: tax accrued (podatki szacunkowe → podatek naliczony)
- pl: contra-asset (aktywów przeciwnych → aktywów korygujących)
- pt: disposal terminology (descartado → alienado, 2 entry pairs)
- pt: disposal-clearing invoiced value (valor recebido → valor faturado)
- tr: supplier invoice (gönderildiğinde → muhasebeleştirildiğinde)
- tr: customer invoice (gönderildiğinde → muhasebeleştirildiğinde)
- tr: disposal-clearing account (geçici elden çıkarma mahsup hesabı)
- tr: manufacturing overhead (üretim maliyetleri → üretim genel giderleri)

## Constraints
- Edit ONLY the msgstr lines explicitly flagged. Do not touch msgid lines, surrounding context, or other entries.
- Verify structural integrity: `git diff --numstat` should show equal added/deleted lines per `.po` file.
- Both typecheck commands must PASS before committing.
- Do not modify any files outside `packages/locale/locales/`.
