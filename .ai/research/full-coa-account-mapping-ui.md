# Full Chart-of-Accounts Mapping UI — Competitor Research

**Date:** 2026-08-27
**Context:** Carbon (manufacturing ERP) syncs journals to Xero, QuickBooks Online, and Rillet.
Today only a small "required" set of posting-default accounts is mappable. We're extending it so
ANY chart-of-accounts entry can be mapped (full CoA), while keeping the required set distinguished.
This surveys how best-in-class accounting integrations present the account-mapping configuration screen.

---

## The single most important framing: two archetypes answer these questions oppositely

Every product surveyed falls into one of two camps, and the camp determines nearly every mechanic below.

| | **Sync / posting connector** (ongoing integration) | **Migration / conversion tool** (moving books once) |
|---|---|---|
| Examples | A2X, Synder, Webgility, Dext Commerce, Bookkeep, Ramp, BILL, Brex, Rippling, Puzzle | JetConvert, Movemybooks, Xero Conversion Toolbox, NetSuite Multi-Book CoA mapping |
| What you map | a **small curated set of posting keys** (Sales, Fees, Shipping, Tax…), each → 1 GL account | the **entire chart**, one source-account row → one target-account |
| CoA role | external system OWNS the chart; it only fills dropdowns | the chart IS the thing being mapped |
| UI shape | tabs/sections of named fields, each a type-filtered dropdown | two-column source→target grid, drag or dropdown per row |
| Auto-match scope | pre-select DEFAULTS on the ~dozen keys | green "verify me" fuzzy match across ALL rows |

**Implication for Carbon:** Carbon is a *sync connector*, so the dominant precedent says do NOT surface hundreds
of flat rows as the primary screen. But Carbon's ask ("map ANY CoA entry") is a hybrid — keep the curated
required set as the primary surface, and make the full chart an *opt-in expansion*, not the default view.
A flat hundreds-row grid on an ongoing sync is a known anti-pattern that no sync connector ships.

---

## Q1 — Required vs optional mapping (block or warn?)

**Universal truth: the GL account is the one non-negotiable field.** Everything else is optional-with-fallback.
Enforcement is almost always **reactive** (a queue/pipeline or post-time validation), not an upfront wizard gate.

Concrete patterns:

- **Bookkeep — dynamic red asterisk (the best pattern).** Only lines with a **red `*`** are required to post,
  and requiredness is **lazy/dynamic**: "If new financial data appears in a previously optional line, Bookkeep
  will mark that line as required and it will fail to post to accounting until that line is mapped." So an optional
  line is *promoted to required the moment real data lands on it* — you are never forced to map lines that never
  see traffic. (https://bookkeep.netlify.app/docs/account-setup/connecting-an-accounting-platform/mapping-to-your-chart-of-accounts)
- **A2X — color state + notification bar.** Unmapped transaction lines are **yellow; they turn white when mapping
  is complete.** A notification bar appears when lines lack an account or tax rate. The Getting Started checklist
  enforces order (Connect → Accounts & Tax Mapping → Reconcile) and gates the **Send** step (not the whole product)
  on complete mapping. (https://support.a2xaccounting.com/en/articles/6020564-a2x-mapping-page-tips-and-tricks)
- **Brex — hardest gate.** The **Export button is grayed out** until all mapping issues resolve ("You cannot export
  expenses with uncategorized GL fields to your ERP"); inline errors name the fix. Required *system* accounts (AP,
  manual payments, rewards) are enumerated; optional mappings "appear only when that feature is active."
  (https://www.brex.com/support/integration-exporting)
- **Ramp — required field, enforced via pipeline not gate.** "The GL Account field is always required for syncing"
  so it can't be disabled; other dimensions are admin-configurable as required-or-not. Enforcement is the
  **Waiting for Cardholder → Needs Review → Ready to Sync** pipeline — an under-coded txn simply can't advance.
  (https://support.ramp.com/hc/en-us/articles/4434982407443-Overview-of-Ramp-Accounting)
- **BILL — warn-and-queue with a catch-all.** Mandatory: one AP account, per-bank GL, and a **catch-all
  "Ask my Accountant / Uncategorized" expense account**. Uncoded items fall to the catch-all rather than blocking;
  the real block is deferred to a per-transaction sync error. (https://help.bill.com/direct/s/article/115005443106)
- **Alvys — does NOT block activation.** Only default revenue + default expense are mandatory; everything else is
  optional and **falls back to the default account**, with unmapped edge cases failing per-transaction into an
  Error Transactions queue. (https://docs.alvys.com/help/en/articles/14044234-how-to-map-accounts-for-quickbooks-online)
- **Auxo (Xero) — inline "This field is required".** "All mapping fields must be completed to avoid integration
  errors." (https://learn.auxosoftware.com/en/articles/9770445-xero-setup-2-account-mapping)

**Verdict:** Nobody hard-blocks the whole product on optional accounts. Best practice = distinguish required vs
optional with a **required-fallback default** for the common case, hard-block only truly-required keys, and
(Bookkeep's insight) **promote an optional line to required lazily when unmapped data actually arrives.**
Signals used, in order of elegance: dynamic red asterisk (Bookkeep) > yellow→white row color (A2X) >
disabled export + inline error (Brex) > pipeline stage that can't advance (Ramp).

---

## Q2 — Full chart of accounts vs key accounts (MOST IMPORTANT)

**Hard, consistent split: sync connectors map a KEY SET; only migration tools map the full CoA.**

Sync/posting connectors — curated key set (~a dozen rows), CoA only inside dropdowns:
- **A2X** maps by **transaction type × marketplace** (Sales, Shipping, Refunds, fees, marketplace-facilitator tax,
  gift cards…), grouped by account type, each row an Account + Tax-Rate dropdown filled from your imported CoA.
  You never walk your whole chart. (https://www.a2xaccounting.com/ecommerce-accounting-hub/how-a2x-handles-accounts-and-taxes-mapping)
- **Bookkeep** maps **each journal-entry line**, and the dropdown for each line is **filtered to the account types
  commonly used for that line** — explicitly not the whole chart. (bookkeep docs, above)
- **Dext Commerce** uses **"Mapping Central"** — suggested mappings across **six base data groups** (sales accounts,
  clearing accounts, sales-tax codes, contacts, products, tracking), a curated-group model, not a CoA dump.
  (https://www.greenback.com/sales)
- **Synder** maps via **Settings tabs** (Sales, Fees, Payouts, Taxes, Products) of individual dropdowns; hard-required
  ones are Clearing Account, per-product Income Account, Fees Vendor/Category, Payouts checking account.
  (https://synder.com/help/customize-your-synder-shopify-settings-quickbooks-online/)
- **Webgility** spreads mapping across Sync Settings sections (income, shipping, discounts, tax item, payment
  methods, deposit account), specific dropdowns not a CoA table. (https://helpcenter.webgility.com/en/articles/6278272)
- **Brex** has **48 fixed default categories**, each matched to a GL account, with **merchant mappings overriding
  category mappings** — the core primitive is category→GL, not row-per-account.
  (https://www.brex.com/support/general-ledger-accounts)
- **Ramp** imports the full CoA + all dimensions but the mapping surface is **Mapping Rules** (input field —
  Category/Merchant/Location — → GL account), plus the ability to **hide individual GL codes** without deleting.
  (https://support.ramp.com/hc/en-us/articles/7317831293203)

Migration tools — full CoA, one row per account:
- **JetConvert (custom CoA → Xero)** — the definitive full-CoA UX: a **two-column layout**, source accounts on the
  left, Xero destination accounts on the right; **drag** each source into its destination.
  (https://jetconvert.com/how-to-convert-using-a-custom-chart-of-accounts/)
- **Xero Conversion Toolbox / Xero-to-Xero** — same two-column drag model, Xero matches on **account code**.
  (https://central.xero.com/s/article/Import-a-chart-of-accounts-using-the-Conversion-Toolbox)
- **Movemybooks** — converts the **entire** chart 1-to-1 and forces you to **map every account's *type*** first.
  (https://movemybooks.ie/xero-quickstart/)
- **NetSuite Multi-Book CoA Mapping** — full-CoA scale but **rule-based by dimension**, with **CSV import** for bulk;
  an optional feature you can disable entirely. (https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3851620232.html)

**Dominant pattern for avoiding a giant cluttered list:** map a small named set of posting keys, each with a
**type-filtered dropdown** (a sales line offers only Revenue accounts, a rounding line only Current Liabilities),
and let the external system own the chart. Spend tools that *do* import the whole chart keep it usable by
**hiding/disabling** unused codes and **scoping by entity/subsidiary**, not by showing it all.

---

## Q3 — Scale / search / pagination / grouping / bulk / CSV

Notably, **explicit pagination and "unmapped-first" ordering are essentially absent** from the documented tools —
they are gaps/opportunities rather than established patterns. The field makes large charts tractable by:

- **Type-filtered dropdowns** — the biggest lever. Both **Bookkeep** and **Auxo** constrain each row's dropdown to
  the valid account type for that line, shrinking the option list dramatically on a large chart.
- **Grouping by tabs / type / collapsible sections** — **JetConvert** "use the Tabs at the top to filter";
  **Auxo** groups into 5 tabs (General, Payments, Parts, Labour, Settings); **Alvys** uses collapsible sections.
- **Search by name AND code** — **Precoro's** NetSuite CoA import searches by both Name and Code with Select All
  (https://help.precoro.com/how-the-integration-of-chart-of-accounts-works); **Puzzle's** category picker searches
  on account title *or associated keywords* (an authored Keywords field per account)
  (https://help.puzzle.io/en/articles/6986880); **Brex** offers type-to-search when accounts exceed the visible list
  (https://www.brex.com/support/general-ledger-accounts).
- **Bulk / multi-select** — **A2X** has row checkboxes + "set account/tax/tracking in bulk," configurable
  rows-per-page, sort by account type, and exclude-from-view (https://support.a2xaccounting.com/en/articles/6020564);
  **JetConvert** supports Shift/Ctrl multi-select.
- **CSV import of the mapping** — **NetSuite** CoA mapping supports CSV rule loading; Xero conversions start from a
  CSV upload of the source chart before the visual mapper appears.
- **Refresh accounts** — A2X, Xero-to-Xero, Alvys, Ramp all expose a "refresh/re-pull CoA" action so newly-created
  target accounts appear in dropdowns without reconnecting.
- **Scope by subsidiary/entity** — **Ramp→NetSuite** narrows visible GL accounts per entity/subsidiary.

**Verdict:** The proven scale toolkit is **type-filtered dropdowns + type grouping + name/code search + bulk apply +
CSV + refresh** — NOT pagination. "Unmapped-first" ordering is an underserved differentiator Carbon could lead on.

---

## Q4 — Reactive mapping ("this transaction is blocked because an account isn't mapped")

Real and mature, but almost always a **deferred error queue**, not a one-click inline remap. The consistent pattern:
an unmapped item **fails the individual transaction into a queue that names the specific missing account**, and you
fix the mapping from there (usually a round-trip to settings, then re-sync).

- **Ramp — the strongest failed-transaction queue (worth mirroring).** When ≥1 bill fails, a **banner** appears atop
  Bill Pay; clicking **"review" filters the list to only failed transactions** (also a saveable Sync-status filter).
  Clicking into a failed record shows "the specific issue and recommended resolution steps in the Overview section."
  Resolution actions: retry, **"Mark as synced,"** bulk mark-as-synced. Named error articles tell you exactly which
  entity is unmapped and where to fix it. A **Sync History** view (CSV) holds the raw error strings. Caveat:
  account remaps happen in **Export Settings** (a round-trip), not inline on the error row.
  (https://support.ramp.com/hc/en-us/articles/4418336469011, https://support.ramp.com/hc/en-us/articles/37615018036627)
- **BILL — a real conflict queue.** AP has a Sync tab → **"Resolve Conflicts"** (checkbox list, bulk-dismiss or
  individual Resolve → re-sync) with entity-specific messages ("Bill could not be synced because related Vendor(s)
  didn't sync"). Spend & Expense resolves missing-field errors (location/dept unmapped, deleted GL account)
  **inline on the transaction** (edit → set field → re-sync). (https://help.bill.com/direct/s/article/5641889860621)
- **Synder — "Failed → Explain → map → resync."** A failed sync shows **"Failed"**; clicking **"Explain"** on the row
  gives the specific cause ("A mapped account was deleted or renamed…"). Fix loop is explain → go to Settings → add
  mapping → back to transactions → select rows → Actions → Sync. **Not one-click** — a settings round-trip.
  (https://synder.com/help/review-synced-transactions/)
- **Alvys — "Error Transactions queue"** with messages indicating which account is missing; map and re-export.
  (https://docs.alvys.com/help/en/articles/14044234)
- **Webgility — typed validation at post time.** Blocks the *specific order* being posted with a
  "Business Validation Error: Please Choose an Account of Type Bank or Other Current Assets," tying the failed order
  to the fix. (https://helpcenter.webgility.com/en/articles/9750800)
- **Brex — red exclamation marks** flag broken mappings at the export gate; invalid-type errors name the exact
  account. Unmapped categories **silently don't sync**. Docs explicitly: "There's no one-click auto-mapping feature."
  (https://www.brex.com/support/integration-exporting)
- **Puzzle — closest to true one-touch.** Unresolved items sit in **90000-series "Uncategorized"** accounts and a
  Monthly Checklist task; the **AI Categorizer notifies the owner**, who **replies in plain English** ("new laptop
  for John") and the AI assigns it — then **auto-creates a Rule** from the confirmation.
  (https://help.puzzle.io/en/articles/8600305)

**Verdict:** Table stakes = a named error queue that identifies the exact unmapped account and routes to the fix.
A genuine **one-click "map it now" from the error row itself is rare** (everyone does a settings round-trip) — this
is the clearest differentiation opportunity. Puzzle's plain-English-reply-then-auto-learn-a-rule is the most elegant
reactive pattern observed.

---

## Q5 — Auto-match / suggestions

Auto-matching is standard. The **matching key differs by archetype**, and suggestions are applied to whatever that
archetype maps (key set vs full chart):

- **Migration tools match by NAME (fuzzy) and CODE, across the FULL chart:**
  - **JetConvert / Xero-to-Xero:** "we auto-map when the names are similar, these are **highlighted in green**" —
    green = auto-matched-verify-me, a clean visual convention. Xero also keys on **account CODE** on import.
    (https://jetconvert.com/how-to-convert-using-a-custom-chart-of-accounts/)
  - **Movemybooks:** 1-to-1 auto-conversion of every account.
- **Sync connectors pre-select DEFAULTS by match, across the KEY SET only:**
  - **A2X:** "If A2X detects an account that already matches the default, it will be pre-selected," plus an
    **Assisted Setup** questionnaire ("answer three questions" → auto-suggest the required CoA + tax rates) and
    **auto-mapping rules** that route *new* transaction types as they appear (blank rule = flag for review).
    (https://support.a2xaccounting.com/en/articles/6443000-assisted-setup-accounts-and-tax-mapping)
  - **Auxo:** a one-click **"Default Mapping"** button applies baseline assignments.
  - **Bookkeep:** a **"magic wand"** that auto-*creates* the target account rather than matching an existing one.
  - **Synder:** auto-matches **products** by exact name/SKU only (no fuzzy account matching).
- **AI/history-learned GL coding (on transactions, not the mapping grid):**
  - **Ramp:** GL suggestions with a **purple AI icon**; "learns which GL accounts correspond to specific vendors and
    applies those mappings across future transactions." Explicit defaults/rules override AI.
  - **Brex:** **Brex Assistant** suggests mappings from name similarity + past categorization, surfaced under
    "Suggested by Assistant" — **review-and-accept, not auto-applied.** (https://www.brex.com/support/accounting-automation)
  - **BILL:** deterministic **"Automatically map dimensions"** (name-match new values, no retroactive remap) + an
    AI **Invoice Coding Agent.** (https://help.bill.com/direct/s/article/000004430)
  - **Puzzle:** ~90–98% auto-coded, learns a Rule from each confirmation.
  - **Rillet** is AI-native but its model is **standardized mappings at the accounting-model layer + approval-before-post**,
    not a per-account AI-suggested grid. (https://www.rillet.com/product/automated-general-ledger)

**Verdict:** Auto-match by **code first, then fuzzy name, surfaced as a green "verify me" state** is the proven
migration convention; sync connectors pre-select defaults on the key set and lean on history-learned suggestions for
ongoing coding. No sync connector does fuzzy/AI account-name matching across the *full* chart — that only happens in
migration tools where the full chart is the point.

---

## Recommendations for Carbon

1. **Keep the curated required set as the primary screen; make the full CoA an opt-in expansion.** Carbon is a sync
   connector, and no sync connector ships a flat hundreds-row grid as the default. Show the required posting-default
   accounts first (the current UX), with a clearly separated "Additional / optional account mappings" section or an
   "Add account mapping" affordance that reveals the full chart. Don't force the whole chart into view.

2. **Distinguish required from optional with a persistent marker + a readiness summary, and enforce reactively.**
   Use A2X's yellow→white / Bookkeep's red-asterisk convention: required rows carry a `*` (or "Required" pill),
   optional rows don't. Add a small readiness line ("3 of 3 required accounts mapped — ready to sync" /
   "1 required account unmapped — journals to it will fail"). Hard-block only the required set; let optional accounts
   fall back to a default. Do NOT block the whole integration on optional mappings.

3. **Adopt Bookkeep's lazy-required promotion.** Rather than forcing the user to map every possible CoA entry up
   front, mark an optional account as *required* only when a journal actually posts to it unmapped — surface that as
   a new required row. This keeps the required set honest and small while still guaranteeing correctness when real
   data arrives at an unmapped account.

4. **Scale via type-filtered dropdowns + grouping by account type + name/code search + "unmapped-first" ordering.**
   Filter each target dropdown to the compatible external account type. Group the full-CoA table by account
   class/type (Carbon already has account types). Provide a search box that matches on both account number and name.
   Order unmapped rows first (an underserved pattern — genuine differentiation). Skip pagination in favor of these;
   the field shows pagination is unnecessary when the list is grouped and searchable.

5. **Auto-match on connect: by account NUMBER/code first, then fuzzy name, presented as a "suggested — please verify"
   state.** When Carbon first connects to Xero/QBO/Rillet, pre-fill mappings where the Carbon account number or name
   matches an external account, and flag those as suggestions (JetConvert's green "verify me"). Apply this across the
   full chart (since Carbon is exposing it), but only *auto-commit* the required set; leave optional suggestions for
   the user to accept. Xero/QBO both expose account codes over their APIs, making code-match reliable.

6. **Build the reactive "map it now" affordance — this is the standout opportunity.** When a journal fails to sync
   because an account isn't mapped, surface the specific unmapped Carbon account in a "needs attention" list (Ramp's
   banner → filter-to-failed model), and — going beyond every competitor — let the user **resolve the mapping inline
   from the error row** and re-queue, without a round-trip to a settings screen. Everyone names the failing account;
   almost nobody fixes it in one click. Carbon should.

7. **Let the user create/pick and, ideally, create the external account without leaving Carbon** (Brex writes a new
   GL account straight to QBO). At minimum offer a "refresh accounts" action so freshly-created external accounts
   appear in dropdowns without reconnecting.

---

## Sources (primary help-center / docs URLs)

- A2X: how mapping works — https://www.a2xaccounting.com/ecommerce-accounting-hub/how-a2x-handles-accounts-and-taxes-mapping
- A2X: mapping page tips — https://support.a2xaccounting.com/en/articles/6020564-a2x-mapping-page-tips-and-tricks
- A2X: assisted setup — https://support.a2xaccounting.com/en/articles/6443000-assisted-setup-accounts-and-tax-mapping
- A2X: automapping rules — https://support.a2xaccounting.com/en/articles/6459609-navigating-the-accounts-and-tax-page-understanding-automapping-rules
- Synder: settings/mapping — https://synder.com/help/customize-your-synder-shopify-settings-quickbooks-online/
- Synder: review synced (Explain/Failed) — https://synder.com/help/review-synced-transactions/
- Synder: product mapping — https://synder.com/help/product-mapping-feature/
- Dext Commerce (Greenback): sales/Mapping Central — https://www.greenback.com/sales
- Webgility: transactional settings — https://helpcenter.webgility.com/en/articles/6278272-recommended-transactional-settings-for-webgility-online
- Webgility: business validation error — https://helpcenter.webgility.com/en/articles/9750800-business-validation-error-please-choose-an-account-of-type-bank-or-other-current-assets
- Bookkeep: mapping to your CoA — https://bookkeep.netlify.app/docs/account-setup/connecting-an-accounting-platform/mapping-to-your-chart-of-accounts
- Auxo (Xero): account mapping — https://learn.auxosoftware.com/en/articles/9770445-xero-setup-2-account-mapping
- Alvys (QBO): map accounts — https://docs.alvys.com/help/en/articles/14044234-how-to-map-accounts-for-quickbooks-online
- Brex: integration exporting — https://www.brex.com/support/integration-exporting
- Brex: GL accounts — https://www.brex.com/support/general-ledger-accounts
- Brex: mapping rules — https://www.brex.com/support/how-do-i-set-up-mapping-rules-to-auto-categorize-my-transactions
- Brex: accounting automation (Assistant) — https://www.brex.com/support/accounting-automation
- Ramp: accounting overview — https://support.ramp.com/hc/en-us/articles/4434982407443-Overview-of-Ramp-Accounting
- Ramp: accounting rules — https://support.ramp.com/hc/en-us/articles/7317831293203
- Ramp: Bill Pay accounting / errors — https://support.ramp.com/hc/en-us/articles/4418336469011
- Ramp: QBO "account no longer exists" — https://support.ramp.com/hc/en-us/articles/37615018036627
- BILL: manage sync preferences — https://help.bill.com/direct/s/article/115005443106
- BILL: resolve sync conflicts in bulk — https://help.bill.com/direct/s/article/5641889860621
- BILL: automatically map dimensions — https://help.bill.com/direct/s/article/000004430
- BILL: Sage Intacct setup — https://help.bill.com/direct/s/article/360000044486
- Puzzle: CoA guide — https://help.puzzle.io/en/articles/6986858-understanding-your-puzzle-chart-of-accounts-coa
- Puzzle: categorizing a transaction — https://help.puzzle.io/en/articles/6986880
- Puzzle: AI categorization — https://help.puzzle.io/en/articles/8600305
- JetConvert: custom CoA conversion — https://jetconvert.com/how-to-convert-using-a-custom-chart-of-accounts/
- Xero: import CoA / Conversion Toolbox — https://central.xero.com/s/article/Import-a-chart-of-accounts-using-the-Conversion-Toolbox
- Movemybooks: Xero quickstart — https://movemybooks.ie/xero-quickstart/
- NetSuite: Multi-Book CoA mapping — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3851620232.html
- Precoro: NetSuite CoA import — https://help.precoro.com/how-the-integration-of-chart-of-accounts-works
- Emburse: QBO export sync errors — https://help.spend.emburse.com/hc/en-us/articles/22884617121933-QuickBooks-Online-Export-Sync-Errors
- Rillet: automated GL — https://www.rillet.com/product/automated-general-ledger
- Rippling Spend FAQ — https://www.rippling.com/rippling-spend-faq
