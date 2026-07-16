# Task: Address CodeRabbit Round-2 Review Feedback on PR #1157

**PR:** https://github.com/crbnos/carbon/pull/1157  
**Branch:** `fix/1156-fixed-asset-gaap-journals`  
**Base branch HEAD reviewed:** `aa8bbce64` (new commit to fix on top of `e5d0cfad4`)  
**Worktree:** `/home/openclaw/carbon` (already on this branch)

## Context

PR #1157 adds GAAP-correct fixed-asset journal entries. The first round of CR feedback was already addressed (commit `e5d0cfad4`). CodeRabbit has now posted a second review round (at 16:28 UTC) flagging locale translation issues and a glossary definition issue introduced in commit `aa8bbce64` (glossary + locale files).

## Actionable Items

### Group 1 — Glossary verbosity [Minor — correctness]
**File:** `packages/glossary/src/terms.ts` around line 416  
**Issue:** Several new fixed-asset glossary definitions are too verbose (multi-sentence). Keep each definition to exactly one crisp sentence; move extended lifecycle/explanatory details into the existing `href` targets. Preserve the links.

---

### Group 2 — Empty `msgstr` values (new fixed-asset entries missing translations) [Major]

In the following locale files, newly added fixed-asset accounting descriptions have empty `msgstr` values. Fill them with accurate translations:

**Files and entry ranges:**
- `packages/locale/locales/de/erp.po` ~lines 5640-5642 (and possibly 5663-5666, 5679-5681, 8062-8064, 9955-9956, 11680-11682)
- `packages/locale/locales/es/erp.po` ~lines 5640-5642
- `packages/locale/locales/fr/erp.po` ~lines 5640-5642, 5663-5666, 5679-5681, 8062-8064, 9955-9956, 11680-11682
- `packages/locale/locales/hi/erp.po` ~lines 5640-5641, and additional entries for depreciation, impairment, disposal gain/loss, retirement, clearing
- `packages/locale/locales/it/erp.po` ~lines 5637-5642 and nearby
- `packages/locale/locales/ja/erp.po` ~lines 5640-5642
- `packages/locale/locales/ko/erp.po` ~lines 5640-5642
- `packages/locale/locales/pl/erp.po` ~lines 5640-5642
- `packages/locale/locales/pt/erp.po` ~lines 5640-5642, 5664-5665, 5679-5681, 8062-8064, 9955-9956, 11680-11682
- `packages/locale/locales/ru/erp.po` ~lines 5640-5641, 11680-11681
- `packages/locale/locales/tr/erp.po` ~lines 5640-5642
- `packages/locale/locales/zh/erp.po` ~lines 5640-5642

**Entries to translate (look up the English `msgid` in `packages/locale/locales/en/erp.po` to confirm):**
- GL account debited when a fixed asset is acquired (asset/acquisition cost account)
- Accumulated depreciation account
- Impairment account
- Disposal gain/loss account
- Fixed-asset retirement lifecycle account
- Temporary disposal-clearing account (clearing account: shipment debits NBV to this; invoicing credits it and posts gain/loss separately)

---

### Group 3 — Misaligned `msgid`/`msgstr` pairs (translations shifted to wrong entries) [Major — correctness: users see wrong accounting guidance]

Several locale files have translations offset from their msgid, so users see wrong account descriptions. Fix the alignment so each `msgstr` matches its `msgid`:

#### `packages/locale/locales/es/erp.po` ~5607-5624
Translations are semantically corrupted: accumulated-depreciation entry receives customer-invoice text; bank-service-charge entry receives interest-income text. Realign the block from "GL account debited when a fixed asset is acquired..." through "GL account for tax timing differences..."

#### `packages/locale/locales/zh/erp.po` ~5607-5612, 5622-5627
Bank-service-charge entry shows interest-account description; tax-timing and physical-count entries also show unrelated text. Realign so each `msgstr` describes its immediately preceding `msgid`.

#### `packages/locale/locales/fr/erp.po` ~5609-5612 and 5624-5626
Restore the bank-service-charge translation; realign subsequent entries. Also attach the inventory-count variance translation to its own msgid at 5624-5626.

#### `packages/locale/locales/hi/erp.po` ~5607-5612, 5622-5627
Bank-service-charge entry shows interest-income text; tax-timing and physical-count show unrelated text. Realign all affected entries.

#### `packages/locale/locales/it/erp.po` ~5607-5612, 5622-5627
Bank-service-charge receives interest translation; physical-inventory-count receives intercompany translation. Reassociate these entries.

#### `packages/locale/locales/ja/erp.po` ~5607-5611 and 5625-5639
Two ranges affected:
1. 5607-5611: fixed-asset acquisition and bank-service-charge descriptions are shifted
2. 5625-5639: physical-count, source-company debit, target-company credit, sub-cent rounding, and standard-vs-actual-cost entries are shifted

#### `packages/locale/locales/pl/erp.po` ~5607-5612, 5622-5627
Bank charges→interest, interest→purchase tax, tax timing→impairment, physical-count→intercompany. Also the acquisition translation omits "purchase or capitalized cost" and says "in this class." Fix all.

#### `packages/locale/locales/pt/erp.po` ~5607-5624, 5625-5627
Bank-charge, interest, purchase-tax, reverse-charge, tax-timing translations are shifted. Also 5625-5627: replace intercompany wording with physical-count variance account description.

---

### Group 4 — Stale/incorrect translations (Minor — correctness)

#### `packages/locale/locales/de/erp.po` ~5610-5612, 5625-5627
- Bank-service description uses interest-income translation → fix to accurate German for "GL account for bank service charges and similar fees"
- Inventory-count description uses intercompany source-account translation → fix to accurate German for physical inventory-count variance

#### `packages/locale/locales/ru/erp.po` ~5607-5608
Translation says "asset of this class" and omits "purchase or capitalized cost" → update to match current msgid

#### `packages/locale/locales/tr/erp.po` ~5607-5608, 5625-5626
- 5607-5608: only describes purchasing, omits receipt/registration capitalization → include both
- 5625-5626: describes asset write-off, should describe physical inventory-count variance → fix

---

## Acceptance Criteria

1. All empty `msgstr` values for fixed-asset accounting entries are filled with accurate translations in all affected locale files
2. Misaligned `msgid`/`msgstr` pairs are corrected so each translation matches its own `msgid`
3. Stale/incorrect German, Russian, and Turkish translations are corrected
4. Glossary definitions in `packages/glossary/src/terms.ts` for fixed-asset entries are each exactly one sentence (details moved to `href` targets)
5. All changes committed to `fix/1156-fixed-asset-gaap-journals` and pushed
6. No regressions (existing passing tests/CI should not break)
7. Commit message: `fix(locale): correct and complete fixed-asset translations for #1157`

## Execution Notes

- Work in worktree `/home/openclaw/carbon` on branch `fix/1156-fixed-asset-gaap-journals`
- For translation fixes, look up the English `msgid` in `packages/locale/locales/en/erp.po` first to get the exact source text, then produce accurate translations
- For empty entries: add accurate translations using the msgid as the source
- For misaligned entries: read several lines around the flagged range to understand the actual msgid ordering before fixing
- Commit and push when done
