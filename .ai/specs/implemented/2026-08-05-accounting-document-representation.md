# Accounting Document Representation — Journal-Replay Bills, Item-Referenced Invoices, Non-Tracked Provider Items

> Status: implemented — executed 2026-08-05 as **Part B** of the accounting handoff run
> (execution plans removed 2026-08-13; see git history). Sandbox-gated acceptance items remain
> env-gated; the tie-out acceptance criterion shipped with the delivery-robustness work (see the
> note in Acceptance Criteria).
> Author: Brad Barbin + Claude
> Date: 2026-08-05
> Research: provider-capability survey (2026-08-05, this session) + codebase audit of all
> transaction syncers; provider GL-behavior facts flagged VERIFY where inferred from API docs
> rather than observed on a sandbox.
> Related: the posting policy + journal push are documented in
> `.claude/rules/accounting-sync-handlers.md` (the v2 engine and v3 journal-policy specs were
> removed 2026-08-13; see git). This spec fixes how AR/AP **documents** represent their lines;
> it does not change the posting policy or the journal push.

## TLDR

When Carbon pushes a bill or invoice to an external accounting system (QuickBooks Online,
Xero, Rillet), the document's **lines must post to exactly the accounts Carbon's own posting
journal for that document already computed** — nothing more. Today only Rillet's bill syncer
does this (it account-costs from the posted Purchase Invoice journal, hitting GR/IR clearing);
QBO and Xero bills instead reference the **item**, which posts to the item's own account
(COGS / Inventory), leaving GR/IR uncleared and **double-counting cost** against the separately
pushed receipt journal. This spec establishes one principle across all providers —
**a provider document reproduces its Carbon posting journal (document GL ≡ Carbon journal, by
construction)** — with a deliberate AR/AP asymmetry: **AP bills are account-costed journal
replays** (the item is a line label, never a GL driver), **AR invoices are item-referenced**
(the item's revenue account *is* what the invoice should post; COGS stays with the shipment
journal), and **provider items are pushed Non-Inventory / non-tracked everywhere** so the
provider never does inventory or COGS — Carbon owns those. Rillet is already the reference
implementation for both halves; the work is generalizing its bill-costing into a shared core
and bringing QBO and Xero (and Xero's item sync) into line.

## Problem Statement

### The bug: item-referenced bills double-count cost and never clear GR/IR

Carbon is a manufacturing ERP: **Carbon owns inventory and manufacturing costing**, the
external system is the financial books of record. An inventory purchase is a two-step GL flow:

| Event | Carbon journal | Reaches provider via |
|---|---|---|
| **Receipt** (goods arrive) | Dr Inventory / Cr GR-IR | pushed journal (`Purchase Receipt`, `representation: journal`, `defaultEnabled: true`) |
| **Bill** (invoice arrives) | Dr GR-IR (+ PPV, tax) / Cr AP | the **bill document** (`Purchase Invoice`, `representation: document`, DOC_BACKED — the journal is *not* pushed) |

The bill's job is to **clear GR-IR** against the receipt. That only happens if the bill's
lines post to **GR-IR** (and PPV/tax) — i.e. reproduce the Purchase Invoice journal. Current
state (audited 2026-08-05):

| Provider · doc | Line representation today | Correct? |
|---|---|---|
| **Rillet · bill** | account-costed replay of the posting journal → GR-IR | ✅ correct (this is the model) |
| **Rillet · invoice** | item-referenced (`product_id`, product's `account_code` = sales) | ✅ correct |
| **QBO · bill / PO** | `ItemBasedExpenseLineDetail{ItemRef}` for item lines → posts to the item's expense/asset account | ❌ posts to COGS/inventory, GR-IR never clears, **cost double-counted** vs the receipt journal |
| **QBO · invoice** | `SalesItemLineDetail{ItemRef}` → item's income (revenue) account | ✅ correct (revenue is the invoice's job) |
| **Xero · bill** | `ItemCode` + blunt `defaultPurchaseAccountCode`; for **tracked** items Xero force-posts the item's Inventory Asset account and ignores `AccountCode` | ❌ GR-IR uncleared + **inventory double-counted** for tracked items |
| **Xero · invoice** | `ItemCode` + always `defaultSalesAccountCode` | ⚠️ posts to a single default, not the item's real revenue account; tracked items also double-count COGS |

### Provider capability facts that force the design (2026-08-05 survey)

| | Item ref on a line? | Item + independent GL-account override on the same line? |
|---|---|---|
| **QBO** | yes | **no** — an item line's account is the item's config; no per-line override |
| **Xero** | yes (`ItemCode`) | **yes for non-tracked**; for **tracked** items Xero ignores `AccountCode` and posts to Inventory Asset |
| **Rillet** | **bills: none** (account_code + amount only); invoices: product-based | bills: n/a; invoices: GL only via nested `revenue.account_code` |

Consequences: you **cannot** attach an item to a QBO bill line and independently direct its GL,
and a **tracked** Xero item hijacks the GL regardless of what you send. So an item reference on
a *purchase* document cannot be made to hit GR-IR — item references and GR-IR clearing are
mutually exclusive on the purchase side.

## Proposed Solution

### The principle

> **A provider document posts to exactly the accounts Carbon's posting journal for that
> document computed.** Then the provider's GL for the document equals Carbon's GL for it *by
> construction* — correct on every provider regardless of item/tax/inventory quirks. Item
> identity rides as a line **label** (description; plus a no-side-effect structured reference
> where a provider supports one), never as a structural driver of the GL account. Provider
> **items are Non-Inventory / non-tracked**, so the provider never posts inventory or COGS —
> Carbon owns those via its pushed journals.

This is tautological correctness: you cannot drift from Carbon's books because the document
*is* a replay of them. It also unifies item lines, G/L-account lines, and variance lines —
the journal already contains all of them, so the document builder never branches on line type.
*(Corrected 2026-08-05 review: tax is NOT a journal line — Carbon's purchase posting folds tax
into line cost, so replay lines already embed it and are pushed tax-neutral; see §1c.)*

### The AR/AP asymmetry (why "just add items" is wrong for bills but fine for invoices)

Purchases are a **two-step** flow with a clearing account (receipt → bill); the bill's job is
to clear GR-IR, which is *not* the item's account. Sales revenue is **single-step**: the
invoice books Dr AR / Cr Revenue, and COGS/inventory come *separately* from the pushed
`Sales Shipment` journal. So the item's natural account aligns with the document's job for AR
(revenue) but not for AP (clearing). Hence:

1. **AP bills → account-costed journal replay** (item as label).
2. **AR invoices → item-referenced** to the item's revenue account (COGS stays with the
   shipment journal).
3. **Non-posting documents (PO, SO, Xero Quote) → item-referenced, unchanged** — they don't
   post to the GL, so there is no correctness constraint and item detail is pure benefit.
4. **Provider items → Non-Inventory / non-tracked everywhere** — the single guard that stops
   the provider from posting inventory (bills) or COGS (invoices) behind our back.

### 1. AP bills — generalize Rillet's journal-replay into a shared core

Rillet's `mapBillToRilletBill` / `fetchPostingJournalLines` / `filterBillCostingLines`
(`providers/rillet/entities/bill.ts`) already implement the correct model: the bill items are
the posted `Purchase Invoice` journal's lines (debit-signed) minus the AP control line, each
mapped to a provider account through the account-mapping. Extract this into a shared
**`core/document-costing.ts`**:

- `loadBillCostingLines(db, { companyId, billId, payablesAccountId }) → CostingLine[]`
  (`{ accountId, amount (debit-signed), description, sourceItemId?, dimensions? }`), reading the
  posted Purchase Invoice journal and excluding AP control lines — one implementation, three
  consumers.
- **Item label enrichment (the visibility win):** *(join corrected 2026-08-05 review)* the
  journal reference is **not** the invoice-line id: `post-purchase-invoice` stamps
  `journalLine.documentLineReference = 'purchase-invoice:<purchaseOrderLineId>'` (prefixed,
  **PO-line**-keyed) and stamps **nothing** for direct no-PO invoice lines. The join is
  strip-prefix → `purchaseOrderLine.id` → `purchaseOrderLine.itemId` → item code/name;
  **direct (no-PO) invoice lines get no label in v1** (`sourceItem: undefined`, description
  falls back to the journal line description; optional out-of-scope follow-up: stamp
  references for direct lines in the edge fn). Journal lines are built per invoice line (one
  GR-IR line each, never aggregated per account), so per-line labels are structurally sound.
  Providers put the label in the line **description** (Rillet, QBO) and, where safe, a
  structured reference (Xero `ItemCode` on a non-tracked item, alongside the GR-IR
  `AccountCode`). Variance/rounding lines have no source item — fine.
- Providers become thin adapters over `CostingLine[]`:
  - **Rillet** — unchanged behavior; refactored onto the shared loader (+ item in description).
  - **QBO bill** — emit **`AccountBasedExpenseLineDetail`** lines (`AccountRef` = mapped GR-IR/PPV account, `Description` = item label). Stop using `ItemBasedExpenseLineDetail` on bills. *(Resolved 2026-08-05 review: the **PO stays on the existing item-referenced `buildQboExpenseLines`** — it is non-posting (§4); do not touch the shared builder.)*
  - **Xero bill** — emit `LineItem{ AccountCode = mapped account, Description, TaxType: "NONE", ItemCode? }`,
    where `ItemCode` is included only when the item is known non-tracked (see §3 rollout rule).

Unmapped/absent account and unposted-journal handling stays exactly as Rillet's today
(structured `UNMAPPED_ACCOUNTS` Warning — park, never guess an account).

**Posted-status gate (added 2026-08-05 review):** none of the three bill syncers has a
`shouldSync` today — Xero even maps Carbon `Draft` → Xero `DRAFT`. Under journal replay a
Draft bill has no posted journal, so every Draft-bill sync would land an `UNMAPPED_ACCOUNTS`
Warning (ledger noise). All three bill syncers gain a posted-status `shouldSync` mirroring the
invoice syncers' `SYNCABLE_STATUSES` (which exclude Draft). Deliberate behavior change:
QBO/Xero stop receiving Draft bills — the provider is the books of record; drafts never
belonged there.

### 1b. Currency — replay in transaction currency with a pinned rate (added 2026-08-05 review)

The journal is always **base currency**, but the bill document must carry the vendor's
transaction currency (Xero sends `CurrencyCode` + `CurrencyRate`; the vendor invoice total is
a transaction-currency number). The shipped Rillet mapper has this latent bug today: it pushes
base-currency journal amounts **labeled with the transaction currency** and omits
`exchange_rate`. Under FX, "document GL ≡ Carbon journal" only holds if the provider's rate is
pinned to Carbon's. Resolution:

- `loadBillCostingLines` returns **base-currency** debit-signed amounts (journal truth) plus
  the invoice's `currencyCode` and `exchangeRate`.
- A shared helper converts to transaction currency: `txnAmount = baseAmount / exchangeRate`,
  2dp-rounded, rounding residue balanced into the largest-|amount| line so the lines sum
  exactly to the invoice's transaction-currency total.
- Every provider pins the rate: Xero `CurrencyRate = exchangeRate`, QBO `ExchangeRate =
  exchangeRate` + `CurrencyRef` (fields added to the QBO Bill payload schema — today it sends
  neither), Rillet `exchange_rate = exchangeRate` (`BillSchema` already allows it). Provider
  base GL = Carbon GL up to rounding.
- Base-currency bills (`exchangeRate === 1`): behavior identical to today.

### 1c. Tax — replay lines are tax-neutral in v1 (added 2026-08-05 review)

Carbon's purchase-invoice posting creates **no tax journal line** — tax is folded into line
cost. Replay lines therefore already embed tax in their amounts, and the provider's tax engine
must not run on top of them: Xero bill lines get `TaxType: "NONE"` (today the Xero bill sends
`TaxType: "INPUT"` + `TaxAmount`, which would double-tax replayed amounts), QBO bills stay
tax-free (no `TxnTaxDetail` — unchanged), Rillet items never set `tax_rate` (unchanged).

**Documented consequence:** input VAT/GST on Carbon-pushed bills does **not** appear on the
provider's tax reports — the same stance as pushed manual journals today. Fine for US
sales-tax-as-cost; a real limitation for VAT-reclaim jurisdictions. Tax-aware mapping is an
explicit follow-up, not v1. AR invoices are unaffected (Xero keeps its existing
`TaxType: "OUTPUT"` computation — the invoice is item-referenced, not a replay).

### 2. AR invoices — item-referenced to the item's revenue account

Keep the item-referenced model (Rillet already requires `product_id`; QBO already uses
`SalesItemLineDetail{ItemRef}` → the item's `IncomeAccountRef`). The one gap is **Xero**, whose
invoice lines currently use a single `defaultSalesAccountCode`:

- **Xero invoice** — send `ItemCode` (item label/detail) **+ `AccountCode` = the item's mapped
  revenue account**, instead of the blunt default. *(Source resolved 2026-08-05 review: the
  item's mapped sales account — the same resolution that feeds QBO `IncomeAccountRef` and
  Rillet's product `account_code` — NOT the posted journal line. The two diverge only when
  sales posting groups vary by customer group; that divergence is inherent to the
  item-referenced AR decision, applies equally to QBO/Rillet, and the v3 tie-out flags it if
  material.)* Non-tracked items (§3) mean Xero honors the `AccountCode` and posts only
  Dr AR / Cr Revenue — COGS remains with the pushed shipment journal.
- Rillet / QBO invoices: unchanged.

*(A future option — AR invoices as account-costed journal replays for full uniformity — is
rejected here: Rillet invoices are structurally product-based, item-referenced AR is correct,
and it preserves richer AR subledger detail in the provider.)*

### 3. Provider items — Non-Inventory / non-tracked everywhere

The single guard that makes §1 and §2 safe. QBO already does this (`Type: Service | NonInventory`,
**never Inventory** — the documented double-COGS guard). Bring the others in line:

- **Xero item** — push `IsTrackedAsInventory = false` (today it is
  `itemTrackingType !== "None"`, so most manufacturing parts push as tracked, which is the root
  of the Xero double-count). Carbon owns inventory; Xero must not. **Rollout rule (resolved
  2026-08-05 review):** send `false` on **create**; on **update** of an existing item, omit
  the field (Xero rejects flipping tracked→non-tracked while the item has transactions/stock),
  and if the remote item is still tracked, land a `Warning` instructing manual untracking
  (zero the stock, untrack in Xero, retry). Bill lines attach `ItemCode` only when the item is
  known non-tracked. *(Still the highest-risk change — it alters how Xero books item
  documents — and is the reason the Xero bill/invoice fixes are safe.)*
- **Rillet** — products are already revenue objects, not inventory; no change.

### 4. Non-posting documents (PO, SO, Quote)

Purchase Orders (QBO, Xero) and Xero Quotes (Carbon `salesOrder`) do **not** post to the GL —
they are commitments. Item references there are safe and desirable (detail), so they stay
item-referenced. No change required for GL correctness; they benefit passively from §3
(non-tracked items) removing any latent posting side effect. Rillet has no PO/SO objects.

### Where inventory valuation lives (design decision, not a limitation)

- **Financial / GL-level inventory valuation → the external system, correct and automatic.**
  Carbon's pushed inventory journals (receipt, shipment, WIP/absorption/variance, adjustments)
  maintain the provider's Inventory asset, COGS, WIP and variance balances; the balance sheet
  and P&L tie out (v3 account×period tie-out proves it).
- **Item-level / per-SKU valuation → Carbon, the inventory subledger — by design.** A
  manufacturing ERP's costing (standard cost, WIP, absorption, variances, lot/serial,
  multi-location, FIFO layers) cannot be replicated by an accounting system; letting the
  provider track item inventory would produce a *divergent* valuation and double-count. This is
  the canonical ERP-owns-detail / accounting-owns-rollup split.
- **Dimensional inventory reporting in the provider** is available for slotted dimensions
  (Location / ItemPostingGroup / CostCenter → provider Class/Dept/Tracking/Field via v3
  dimension sync) — "inventory value by product line / location", just not per individual SKU.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Correctness model | Provider document ≡ Carbon posting journal (document GL reproduces the journal) | Tautological correctness; provider-quirk-independent; unifies item/GL/tax/variance lines |
| AP bill representation | Account-costed journal replay to GR-IR (item as label) | Bill's job is to clear GR-IR; item refs post to item accounts → uncleared GR-IR + double cost. Item refs and GR-IR clearing are mutually exclusive on purchases (QBO can't override; Xero-tracked hijacks) |
| AR invoice representation | Item-referenced to the item's revenue account | Revenue *is* the invoice's job; item's income account aligns; COGS handled by the pushed shipment journal; Rillet AR is structurally product-based anyway |
| Provider items | Non-Inventory / non-tracked on every provider | Stops the provider posting inventory (bills) / COGS (invoices) behind Carbon's back; QBO precedent; the guard that makes §1/§2 safe |
| Non-posting docs (PO/SO/Quote) | Keep item-referenced | No GL posting → no correctness constraint → item detail is free |
| Item visibility on bills | Line description (all) + structured ref where side-effect-free (Xero `ItemCode` on non-tracked) | Preserves "what did I buy" without letting the item drive the GL |
| Shared code shape | One `core/document-costing.ts` (`loadBillCostingLines`) + thin provider adapters | Mirrors the payment-application core just shipped; Rillet is the reference; no per-provider costing logic to drift |
| Inventory valuation | Financial in provider (via journals); per-item in Carbon (subledger) | Manufacturing costing can't be replicated in accounting; avoids divergence + double-count |
| Data model | No schema change | Reuses `journal`/`journalLine`/`journalLineDimension`, `accountDefault`, `purchaseOrderLine.itemId` (via the prefixed `documentLineReference`), the account/item mappings, and the item syncers |
| Currency (FX bills) | Replay in transaction currency (base ÷ `exchangeRate`, residue balanced into the largest line) + pin the provider rate (Xero `CurrencyRate`, QBO `ExchangeRate`+`CurrencyRef`, Rillet `exchange_rate`) | Journal is base-currency; unconverted replay misstates FX bills (the shipped Rillet mapper's latent bug); pinning the rate keeps provider base GL = Carbon GL |
| Tax on replayed bills | Tax-neutral v1 (Xero `TaxType: NONE`, QBO no `TxnTaxDetail`, Rillet no `tax_rate`); provider tax reports exclude Carbon bills | Purchase posting folds tax into cost (no tax journal line); running the provider tax engine on tax-inclusive amounts double-taxes; same stance as pushed manual journals |
| Bill sync gating | Posted-status `shouldSync` on all three bill syncers (mirror invoices' `SYNCABLE_STATUSES`) | A Draft bill has no posted journal to replay; avoids Warning noise; drafts don't belong in the books of record |
| Xero tracked-item flip | `false` on create; omit on update + `Warning` if remote still tracked | Xero rejects untracking items with transactions; keeps the rollout unblocked without a sandbox dependency |
| Xero AR revenue source | Item's mapped sales account (same source as QBO `IncomeAccountRef` / Rillet product) | Cross-provider consistency; journal-derived divergence only under customer-group posting variation, caught by tie-out |

## Data Model Changes

**None.** This is a representation change in the syncers. It reuses the posted journal
(`journal`/`journalLine` with `documentLineReference`), `accountDefault.payablesAccount`, the
`externalIntegrationMapping` account + item mappings, and the existing item syncers. No
migration, enum, or table.

## API / Service Changes

All in `packages/ee/src/accounting`:

- **NEW `core/document-costing.ts`** — `loadBillCostingLines(db, args)` (extracted from Rillet
  `fetchPostingJournalLines` + `filterBillCostingLines`), returning base-currency debit-signed
  `CostingLine[]` plus the invoice's `currencyCode`/`exchangeRate`, with the source item
  resolved via `documentLineReference` (strip the `purchase-invoice:` prefix) →
  `purchaseOrderLine.itemId → item`; no label for direct no-PO lines. Plus
  `toTransactionCurrencyLines(lines, exchangeRate)` (÷ rate, 2dp, residue balanced into the
  largest line).
- **`providers/rillet/entities/bill.ts`** — refactor onto `loadBillCostingLines`; add the item
  code/name to the line `description`; **fix the FX labeling bug** (transaction-currency
  amounts + `exchange_rate` instead of base amounts labeled with the transaction currency);
  add the posted-status `shouldSync`. Parity test covers base-currency bills
  (byte-identical); FX bills change deliberately (bug fix).
- **`providers/quickbooks-online/entities/bill.ts`** — build **account-based** lines from
  `CostingLine[]` (GR-IR/PPV), transaction-currency amounts + `CurrencyRef`/`ExchangeRate`
  (fields added to `Qbo.BillSchema`), item name in `Description`, no `TxnTaxDetail`; remove
  item-based expense lines on bills; add the posted-status `shouldSync`.
  **`purchase-order.ts` and `entities/shared.ts` `buildQboExpenseLines` stay untouched** (PO
  is non-posting and remains item-referenced, per §4).
- **`providers/xero/entities/bill.ts`** — build `LineItem`s from `CostingLine[]`
  (`AccountCode` = mapped account, `Description`, `TaxType: "NONE"`, `ItemCode?` only for
  known-non-tracked items), transaction-currency amounts + pinned `CurrencyRate`; journal
  accounts, not the blunt default; posted-status `shouldSync`; pre-flight `Warning` instead of
  a line rewrite when the local document is `Paid`/`Partially Paid` (Xero rejects edits to
  invoices with payments).
- **`providers/xero/entities/invoice.ts`** — `AccountCode` = the item's mapped revenue account
  (decided — same source as QBO `IncomeAccountRef`; not journal-derived), not
  `defaultSalesAccountCode`. Tax handling unchanged (`OUTPUT`, `LineAmountTypes: "Exclusive"`).
- **`providers/xero/entities/item.ts`** — `IsTrackedAsInventory: false` on create; omitted on
  update, with a `Warning` when the remote item is still tracked (drop the
  `itemTrackingType !== "None"` derivation for the outbound push).
- Rillet/QBO invoices and QBO items: unchanged.

## UI Changes

None. (Optionally, a one-line note on the accounting-integration settings page that provider
items sync as non-inventory and per-SKU valuation lives in Carbon — nice-to-have, not required.)

## Acceptance Criteria

> **Note:** the **Tie-out** criterion below (account × period tie-out) shipped as part of the
> delivery-robustness work; it is documented in `.claude/rules/accounting-sync-handlers.md`
> (Reconciliation + tie-out).

- [ ] **AP GR-IR clears (per provider).** In a sandbox: receive an item on a PO (Carbon pushes
      `Dr Inventory / Cr GR-IR`), then post + sync the bill. The provider's **GR-IR account nets
      to zero** and Inventory is debited exactly once. Holds on Rillet, QBO, and Xero.
- [ ] **No double-count.** The item's cost appears once (Inventory, from the receipt journal),
      not also as COGS/expense from the bill. Verified on QBO and Xero (the current failure).
- [ ] **Item still visible.** A PO-backed bill line shows the item code/name (description on
      all; Xero also as `ItemCode`); direct no-PO lines fall back to the journal description
      (known v1 limit — no `documentLineReference` is stamped for them).
- [ ] **FX bill.** A foreign-currency bill pushes transaction-currency lines summing exactly
      to the vendor-invoice total, with the provider rate pinned to Carbon's `exchangeRate`;
      the provider's base-currency GL equals the Carbon journal within rounding.
- [ ] **Tax-neutral replay.** Replayed bill lines carry no provider tax (Xero
      `TaxType: NONE`, QBO no `TxnTaxDetail`); the provider computes no tax on top.
- [ ] **Draft bills don't sync.** A Draft `purchaseInvoice` is skipped by `shouldSync` on all
      three providers (no ledger Warning noise); posting it triggers the sync.
- [ ] **AR posts to revenue.** A sales invoice posts `Dr AR / Cr <item revenue account>` on all
      three providers (Xero no longer uses the blunt default); COGS appears only from the pushed
      shipment journal, once.
- [ ] **Xero items are non-tracked.** A synced Xero item has `IsTrackedAsInventory = false`; a
      bill/invoice referencing it triggers no provider-side inventory/COGS posting.
- [ ] **Rillet AR/AP parity.** Rillet bill (now via the shared core) and invoice produce the
      same GL as before; existing tests stay green.
- [ ] **Tie-out.** After a full receive→bill→ship→invoice cycle, the v3 account×period tie-out
      shows zero external delta on Inventory, GR-IR, COGS, AP, AR, and Revenue.
- [ ] `pnpm --filter @carbon/ee test` + scoped typechecks green; new unit tests cover
      `loadBillCostingLines`, the three bill adapters, the Xero invoice revenue account, and the
      Xero non-tracked item.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| QBO/Xero bill GL changes are real posting changes | High | Sandbox receive→bill acceptance (GR-IR nets to zero) before relying on it; tie-out gate; the model is a faithful replay of Carbon's own journal, so correctness is by construction |
| Xero `IsTrackedAsInventory=false` changes existing Xero item behavior | High | It removes a double-count, not adds one; document the change; verify a tracked→non-tracked item still syncs and its documents post only AR/AP + the mapped account |
| Provider GL behavior inferred from API docs, not observed | Med | VERIFY flags on each provider claim (Xero tracked-item account hijack; QBO item-account posting); resolved by the sandbox acceptance runs |
| Existing Xero bills/invoices in the field already posted the "wrong" way | Med | This is forward-only representation; historical documents are untouched (no DELETE sync); note in the changelog that pre-fix documents may carry item accounts |
| Item label enrichment mis-joins a journal line to an item (aggregated/variance lines) | Low | Only `documentLineReference`-linked lines get a label; variance/rounding lines have none; direct no-PO lines have no reference at all (v1 limit) — expected |
| Negative costing lines (credit PPV) rejected by a provider | Med | Xero accepts negative `LineAmount`; QBO negative bill-line `Amount` is a VERIFY gate — fallback: net lines per account in the builder |
| Re-sync of an already-paid provider bill fails (Xero rejects line edits on paid invoices) | Med | Pre-flight `Warning` when the local document is Paid/Partially Paid; otherwise surfaced as a provider error in the ledger — forward-only, documented |

## Open Questions

> Combined spec request — resolutions are **Autonomous** (codebase precedent + provider-capability
> facts), surfaced for Brad's veto. No Ask-First items: no schema change, no auth/RBAC/tenancy,
> no public contract, no new dependency.

- [x] **Where does inventory valuation report?** — **Answer (Brad's question, 2026-08-05):**
      financial/GL-level valuation lives in the provider (correct, via Carbon's pushed inventory
      journals + the tie-out); per-item/SKU valuation stays in Carbon as the inventory subledger;
      dimensional slices (by location/product line) are available in the provider via the v3
      dimension sync. This is the intended ERP-owns-detail / accounting-owns-rollup split, and it
      is *why* non-tracked provider items are correct rather than lossy.
- [x] AR invoices — item-referenced vs journal replay? — **Autonomous: item-referenced.** Revenue
      = the invoice's job = the item's income account; Rillet AR is structurally product-based;
      preserves AR subledger detail. COGS via the shipment journal.
- [x] AP bills — item ref + account override anywhere? — **Autonomous: no, account-costed replay.**
      QBO can't override an item line's account; Xero-tracked hijacks it; Rillet bills have no item
      field. Item refs and GR-IR clearing are mutually exclusive on purchases.
- [x] Keep item visibility how? — **Autonomous: description label everywhere + Xero `ItemCode`
      (non-tracked, no side effect).**
- [x] Do POs/SOs need changing? — **Autonomous: no** — non-posting; item refs are safe there.
- [x] FX bills — base or transaction currency? — **Autonomous (2026-08-05 review):**
      transaction currency (base ÷ rate, residue-balanced) + pinned provider rate (§1b); the
      shipped Rillet base-amounts-with-transaction-label behavior was a latent bug, fixed as
      part of the refactor.
- [x] Tax on replayed bills? — **Autonomous (2026-08-05 review):** tax-neutral v1 (§1c);
      provider tax reports exclude Carbon bills; tax-aware mapping is a follow-up. Also
      corrects the earlier claim that the journal "contains tax lines" — purchase posting
      folds tax into cost.
- [x] Do Draft bills keep syncing? — **Autonomous (2026-08-05 review):** no — posted-status
      `shouldSync` on all bill syncers (deliberate behavior change; drafts have no journal to
      replay).
- [x] Xero AR revenue account — item default or journal line? — **Autonomous (2026-08-05
      review):** the item's mapped sales account, for consistency with QBO `IncomeAccountRef`
      and Rillet's product account; customer-group posting divergence is inherent to
      item-referenced AR and caught by tie-out.

## Changelog

- 2026-08-05: Created. Motivated by a Rillet bill showing `GR/IR Clearing` instead of an item
  (which is actually correct), and Brad's directive to fix line representation across all
  integrations. Provider-capability survey + full transaction-syncer audit this session
  established that the item-referenced bill approach (QBO, Xero) double-counts cost and never
  clears GR-IR, and that account-costed journal replay (Rillet's model) is the correct,
  provider-quirk-independent representation. Design resolved autonomously under the combined
  spec delegation; inventory-valuation question answered inline. Implementation plan to follow
  at `.ai/plans/archived/2026-08-05-accounting-document-representation.md`.
- 2026-08-05 (review): Pre-implementation review amendments, grounded against the working
  tree. Corrected the item-label join (`documentLineReference` =
  `purchase-invoice:<purchaseOrderLineId>` — prefixed, PO-line-keyed, absent on direct no-PO
  lines; not `purchaseInvoiceLine.id`). Added §1b Currency (transaction-currency replay +
  pinned provider rate; fixes Rillet's latent FX labeling bug) and §1c Tax (tax-neutral replay
  v1). Added the posted-status `shouldSync` gate for bills, the Xero tracked-item
  create/update rollout rule, and the Xero AR revenue-account source decision (item's mapped
  sales account). PO / `buildQboExpenseLines` explicitly untouched. New risks: QBO
  negative-line VERIFY; paid-document re-sync. Plan updated in lockstep.
- 2026-08-11: Reconciliation pass — status set to **implemented** (executed 2026-08-05 as
  Part B of the accounting handoff run); the tie-out acceptance criterion was later delivered by
  the delivery-robustness work (see `.claude/rules/accounting-sync-handlers.md`). No design changes.
