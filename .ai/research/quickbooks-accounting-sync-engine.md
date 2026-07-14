# QuickBooks Integration + Accounting Sync Engine Research: Best Practices Survey

> Researched 2026-07-08. Scope: QuickBooks Enterprise Solutions: Manufacturing & Wholesale 24.0
> (QuickBooks **Desktop**) integration for Carbon, plus refactoring the Xero integration into a
> generic accounting sync engine that handles both entity sync and posting (GL) sync.

## Summary

Surveyed Intuit primary sources, the two canonical QBD manufacturing integrations (Fishbowl,
MISys), five cloud MRP multi-provider sync engines (Katana, Cin7 Core, Unleashed, SOS,
MRPeasy, Fulfil), bridge vendors (Conductor, Codat, Merge, Rutter, Apideck), and the
SAP/NetSuite/iPaaS posting-interface canon — against a full inventory of Carbon's existing
`packages/ee/src/accounting` engine and posting pipeline. Headline findings: **(1)** QB Desktop
has no REST API, no webhooks, and no OAuth — the only cloud path is the QuickBooks Web
Connector (a Windows app that polls YOUR SOAP endpoint with qbXML); every bridge vendor wraps
it. QuickBooks **Online** is a completely different platform (OAuth2/REST); "QuickBooks
support" is therefore two providers, not one. **(2)** Enterprise 24.0 is not a dying version —
it is the *terminal, continuously-updated* Desktop platform with no announced end date, still
sold to new customers; and no modern cloud MRP serves it (Katana/Cin7/Unleashed/Fulfil are all
QBO/Xero-only), making QBD support genuine differentiation for exactly the manufacturing
segment Carbon sells to. **(3)** The industry-consensus posting model is **native documents
for AR/AP** (invoices, bills, payments — which Carbon's engine already syncs) **plus journal
entries for inventory economics** (COGS, adjustments, WIP/production, variances — which Carbon
doesn't sync yet), with configurable per-transaction vs daily-summary consolidation and a flat
named-role account-mapping page — Carbon's existing `accountDefault` + per-entity-override
design maps onto this directly. **(4)** Carbon's provider abstraction is further along than
assumed (generic `BaseEntitySyncer`, `SyncFactory`, `externalIntegrationMapping`), but it
assumes synchronous request/response REST providers with OAuth2 credentials; QBD's inverted
poll-based transport forces the one big architectural addition the enterprise canon demands
anyway: a **durable per-record sync outbox/state machine** (pending → pushed → confirmed →
failed) with an error inbox, idempotency keys, and periodic reconciliation.

## Research Questions

1. What integration surface does QB Desktop Enterprise 24.0 actually expose (qbXML version, Web
   Connector, SDK) and what is the real auth model — does OAuth even apply, or is that
   QuickBooks Online only?
2. How does a cloud SaaS reach a customer's on-prem QB Desktop — self-hosted QBWC SOAP endpoint
   vs a bridge vendor (Conductor, Codat, …) — and what is the build-vs-buy tradeoff?
3. Which entities do competitor manufacturing ERPs sync, in which direction, and do they post
   financials as native documents (invoices/bills) or as journal entries (detail vs daily
   summary)?
4. What is the standard architecture for a multi-provider accounting sync engine (external-ID
   mapping, account mapping, idempotency, retries, queues, reconciliation)?
5. What qbXML transaction coverage does Carbon need (customers, vendors, items, invoices, bills,
   payments, JournalEntryAdd, inventory adjustments) and what are its known limits?
6. What is QB Desktop's lifecycle/EOL status in 2026, and does that push the design toward also
   targeting QuickBooks Online from day one?

## Carbon Current State (Codebase Baseline, verified 2026-07-08)

### The sync engine already half-exists

`packages/ee/src/accounting/` contains a provider-neutral core, with Xero as the only live
provider (`providers/xero/`). The old `packages/ee/src/xero/` folder is now mostly config
(`config.tsx` integration definition + empty `xeroOnInstall()` hook); real sync logic lives in
the accounting core.

**Provider-agnostic core (reusable as-is):**

- `BaseEntitySyncer<TLocal, TRemote, TOmit>` (`accounting/core/types.ts`, ~800 lines) — push /
  pull / batch, cooldown (60s per entity per direction), timestamp comparison, conflict
  resolution by `owner`, optional `shouldSync()` business gate, `ensureDependencySynced()` JIT
  dependency sync (e.g. vendor before bill).
- `SyncFactory.getSyncer(context)` (`accounting/core/sync.ts`) — dispatch by entity type.
- `ExternalIntegrationMappingService` (`accounting/core/external-mapping.ts`) — all ID links via
  the `externalIntegrationMapping` table: `(entityType, entityId, integration, companyId)`
  unique, partial-unique on external ID, `lastSyncedAt` (cooldown), `remoteUpdatedAt` (pull
  bailout), JSONB `metadata`.
- `companyIntegration` table — per-company integration row; JSONB `metadata` stores credentials +
  settings; `verifiedAt`.
- Sync config semantics (`accounting/core/models.ts`): per entity `{ enabled, direction:
  two-way | push-to-accounting | pull-from-accounting, owner: carbon | accounting }` +
  `ENTITY_DEFINITIONS` dependency graph. NOTE: company-level `syncConfig` is parsed but NOT yet
  applied — `DEFAULT_SYNC_CONFIG` is hardcoded (`core/service.ts`).
- Inngest jobs: `sync-external-accounting` (webhook/manual pulls + pushes),
  `accounting-backfill` (full entity backfill), `events/sync.ts` (Carbon DB writes → push;
  DELETE logged/skipped — deliberately unimplemented per `packages/ee/AGENTS.md`).
- `withTriggersDisabled()` wraps sync DB writes to prevent loops.

**Entity sync matrix today (Xero):**

| Entity | Direction (default) | Owner | Trigger | Notes |
|---|---|---|---|---|
| customer | two-way | accounting | Xero webhook, backfill, DB-write events | One Xero Contact backs BOTH customer + vendor (`IsCustomer`/`IsSupplier`) |
| vendor | two-way | accounting | same | |
| item | push-to-accounting | carbon | backfill, DB-write events | |
| invoice (AR) | two-way | accounting | webhook (ACCREC), backfill, events | |
| bill (AP) | two-way | accounting | webhook (ACCPAY), backfill, events | |
| purchaseOrder | push-to-accounting | carbon | backfill, events | |
| salesOrder | push (disabled) | carbon | — | |
| inventoryAdjustment | push (disabled) | carbon | — | |
| payment | pull (disabled, stub) | accounting | — | |
| employee | disabled | carbon | — | Xero dropped Employees API |

**Hard-coded Xero-isms a generic engine must abstract:**

1. `ProviderCredentialsSchema` is a discriminated union with only an `oauth2` variant — QB
   Desktop (Web Connector) is username/password + session ticket, a fundamentally different
   shape (and an inverted, poll-based connection model).
2. `tenantId`/`tenantName` in credentials; `xero-tenant-id` header; `GET /connections` tenant
   discovery.
3. OAuth URLs + scopes hardcoded in `xero/config.tsx` / `providers/xero/provider.ts`.
4. Pagination (100/page), .NET date parsing (`/Date(...)/`), phone-type mapping, dual
   customer+vendor Contact logic in `ContactSyncer`.
5. `DEFAULT_SYNC_CONFIG` hardcoded rather than per-company `syncConfig`.
6. Webhook handler (`routes/api+/webhook.xero.ts`) is Xero-specific: HMAC verification
   (fail-open without secret), CONTACT/INVOICE categories only, synchronous Xero GETs to
   resolve entity types.

**Existing provider stubs:** `packages/ee/src/quickbooks/config.tsx` (51 lines, `active:
false`) is wired for **QuickBooks Online** OAuth2 (`appcenter.intuit.com`,
`com.intuit.quickbooks.accounting` scope) — NOT Desktop. `packages/ee/src/sage/config.tsx` is a
similar placeholder.

### Posting/GL side (what the sync engine must carry)

- Journal model: `journal` (status `Draft|Posted|Reversed`, `sourceType` enum of ~19 source
  types, `postingDate`, `accountingPeriodId`, `reversalOfId`/`reversedById`, and — already
  added for integrations — `externalId`, `sourceSystem`, `sourceApiKeyId`) + `journalLine`
  (accountId, signed amount) + `journalLineDimension`.
- Posting happens in Deno edge functions (`post-sales-invoice`, `post-purchase-invoice`,
  `post-receipt`, `post-shipment`, `post-payment` + `build-payment-journal`, `post-memo`,
  production/job functions). Account resolution: `accountDefault` flat company defaults
  (receivables/payables/inventory/COGS/cash/FX gain-loss…) + `itemPostingGroup` per-group
  overrides + per-location GL accounts. Posting-group N×M matrices are a REJECTED pattern
  (`.ai/lessons.md`).
- AR/AP: `salesInvoice`/`purchaseInvoice` + `payment` + `invoiceSettlement` with tie-out RPCs
  (`get_ar_tie_out`, `get_ap_tie_out`, aging). Memos post as Credit/Debit Memo journals.
- Period close: `journal_check_period_open` trigger blocks posting into closed periods; period
  lifecycle Open → Locked → Closed.
- `.ai/specs/2026-07-04-integration-surface.md` (finalized, unimplemented) defines the public
  surface: Trial Balance API, JE export (streaming), **idempotent JE import API** (period- and
  approval-gated, stamps `externalId`+`sourceSystem`), and outbound webhooks
  (`journal_entry.posted`, `journal_entry.reversed`, `period.locked/closed/reopened`,
  `approval.decided`) delivered via PGMQ → Inngest with HMAC signing. Blocked by #1032
  (document approvals) and #1047 (record integrity/JE export definition).
- Cutover (#1057): opening-balance journal at cutover − 1; sync engines must never backdate
  into pre-cutover/closed periods.

**Gaps for posting sync (confirmed absent today):** no `journalEntry` entity type or syncer; no
GL account mapping storage/UI (Xero chart can be fetched but isn't mapped to Carbon accounts);
payments stubbed off; no reconciliation state; no tax-rate mapping; DELETE sync unimplemented.

**Lessons that bind the design (`.ai/lessons.md`):**

- Resolve control accounts by `accountDefault.<x>Account` **id**, never by account number/name.
  External account codes (Xero AccountCodes, QB FullName) are legitimate ONLY as integration
  mapping keys → map external code → `externalIntegrationMapping` → Carbon `account.id`.
- Chart group headers have `number = NULL` — hierarchy walks must not assume numbers.
- No N×M posting-matrix config — flat defaults + per-entity assignment with per-child override.

## Competitors Surveyed

- **SAP S/4HANA** — enterprise reference for external-posting interfaces (BAPI/IDoc), error
  queues, summarization, reconciliation; OBYC account determination as the matrix anti-pattern.
- **NetSuite** — the model sync *target*: externalId idempotent upserts, period validation,
  custom transaction types.
- **Fishbowl** — the canonical "manufacturing system of record + QB Desktop as books" add-on
  (per-transaction hybrid posting).
- **MISys Manufacturing** — SDK-based QBD manufacturing integration (subledger + batch Period
  End with review-before-post).
- **Katana / Cin7 Core (DEAR) / Unleashed / SOS Inventory / MRPeasy / Fulfil** — cloud
  operational systems with multi-provider (Xero/QBO) accounting sync engines.
- **Intuit (primary)** — QB Desktop SDK/qbXML/Web Connector specs, auth model, lifecycle.
- **Bridge vendors** — Conductor, Codat, Merge, Rutter, Apideck; open-source QBWC servers;
  Celigo/Workato/Boomi iPaaS machinery.

## Key Consensus Patterns

### 1. Hybrid posting: native documents for AR/AP, journal entries for inventory economics
- **Fishbowl**: QB Invoice + separate COGS journal entry per shipment; Item Receipt → Bill for
  purchases; JEs for adjustments/scrap/builds.
- **Cin7 Core / Unleashed / SOS / Katana**: invoices/bills as native documents; manual
  journals for COGS, stock adjustments, stocktakes, assembly/WIP moves.
- **MISys**: real-time Bills where payables must surface; everything else batch JEs.
- **Rationale**: accountants need native AR/AP documents for aging, statements, and payment
  workflows; inventory truth (and item-level detail) stays in the ops system, reaching the GL
  as value-level journals.

### 2. The ops system owns items; target items are non-posting placeholders
- **Fishbowl**: single `FB_Item` placeholder (real part number in the line description).
- **SOS / Katana**: items created as non-inventory/service types; target's inventory tracking
  OFF — both document the duplicate-COGS failure if it's left on.
- **MISys/Fishbowl**: QB Advanced Inventory (FIFO/serial-lot/EIR) must be disabled.
- **Rationale**: two systems tracking item-level inventory value double-post COGS and drift.

### 3. Account mapping is a flat page of named roles + direct per-entity overrides
- **Cin7**: ~11 named roles mapped 1:1; per-product overrides. **Fishbowl**: fixed 21-account
  wizard; per-part overrides. **MISys**: 18 accounting controls + overlay Account Sets resolved
  per-control with fall-through **Job → Item → Location → Default** (the cleanest model).
  **Unleashed**: 3 defaults + per-product/per-customer override.
- **SAP OBYC** is the maximal matrix counter-example everyone else avoids.
- **Rationale**: matches Carbon's `accountDefault` + `itemPostingGroup` design and the
  `.ai/lessons.md` no-N×M rule. The SAP lesson worth keeping: **"no mapping found" must be a
  pre-flight validation error**, not a runtime surprise.

### 4. A visible per-record sync state machine with human levers
- **Cin7**: Pending → Completed / Failed / Warning / Skipped; Failed auto-retries, Warning
  waits for review, Completed→Pending is manual re-send. **Unleashed**: Export Data page +
  variance report; Draft-in-target counts as variance. **SOS**: Preview sync (outbound queue,
  removable records). **SAP**: IDoc status 51 + BD87 edit-payload-and-reprocess. **Celigo/
  Boomi**: per-record error inbox with open/resolved/retry, edit-and-retry, bulk retry,
  resolve-without-retry, digest alerts.
- **Rationale**: at-least-once sync into accounting systems fails routinely (locked records,
  closed periods, name collisions); ops teams need an inbox, not logs.

### 5. Caller-owned external reference key; reverse, never delete
- **SAP**: OBJ_KEY/AWKEY on every posting; reversal by reference via REV_POST. **NetSuite**:
  externalId + `PUT eid:{id}` upsert. **Stripe/canon**: idempotency keys + per-record recovery
  points. **QBD**: `newMessageSetID`/`oldMessageSetID` error recovery + RefNumber/DataExt
  stamping + query-before-insert (RefNumber uniqueness NOT enforced).
- **Rationale**: dedupe across retries and crashed connections; corrections are additive
  reversing entries (Fishbowl's delete-and-replace Item Receipt dance is the anti-pattern).

### 6. Posting granularity is configurable; summarize forward, drill back always
- **Cin7**: per-channel No sync / Individual / Consolidated (daily). **MRPeasy**: documents
  per-transaction + one daily balance journal for inventory/WIP/COGS. **MISys**: Period End
  consolidation setting. **SAP**: OBCY summarization + mandatory drill-back reports.
- **Rationale**: high-volume flows need summary postings; auditors need to explain any GL
  line from source detail.

### 7. Period-close: pre-validate, park as error, optionally re-date
- **Xero**: rejects docs before the lock date (lock date queryable). **QBO**: rejects into
  closed books and **the API cannot read or set the close date** — capture it from the admin
  at connect time. **NetSuite**: optional "post to first open period, keep original date."
  **SAP/iPaaS**: park in the error queue for humans.
- **Rationale**: never silently drop or silently re-date accounting data.

### 8. Cutover is first-class
- **Cin7**: Conversion date + opening balances + load/export historical from a chosen date.
  **Fulfil**: opening trial balance import at go-live. Matches Carbon's #1057 cutover spec —
  sync must never backdate into pre-cutover/closed periods.

### 9. Continuous reconciliation
- **SAP**: control accounts + scheduled consistency checks. **Unleashed**: variance view vs
  provider balances. **Fishbowl**: point-in-time valuation-vs-GL tie-out + "the sync is the
  only writer to control accounts" rule. **Formance canon**: event-level, aggregate, and
  balance matching tiers.
- **Rationale**: drift is expected (local success + downstream failure); detect it on a
  schedule, not in an audit.

### 10. QB Desktop transport reality
- Every remote path is **QBWC polling** — Conductor/Codat/Merge/Rutter all wrap it; cloud MRPs
  simply refuse QBD (Katana explicitly; Fishbowl Drive is QBO-only). Whoever integrates QBD
  owns (or rents) a SOAP endpoint, a per-company work queue, and the customer-side Windows
  failure modes.

## Answers to Research Questions

1. **What does QB Desktop Enterprise 24.0 expose, and does OAuth apply?** Two mechanisms only:
   the local COM SDK (qbXML ≤16.0) and the QuickBooks Web Connector for cloud apps. No REST,
   no webhooks (Desktop REST/Sync Manager died in 2016). **OAuth is QBO-only.** QBD auth =
   .QWC file + out-of-band password + session tickets + the in-QB Application Certificate
   grant (admin, single-user, unattended-mode option). (Intuit QBWC Programmer's Guide, SDK
   release notes.)
2. **How does a cloud SaaS reach on-prem QBD?** QBWC polling our SOAP endpoint — self-hosted
   or rented. Build = SOAP state machine + full qbXML layer + customer-support tail (no
   maintained Node OSS starting point). Buy = Conductor ($49/mo/company file, TS SDK,
   real-time, best mfg coverage, powers Ramp) >> Rutter (credible, enterprise-priced) > Codat
   (batch windows, banking pivot) > Merge/Apideck (thin/new). Autofy's 2024 shutdown is the
   vendor-risk case study → isolate any vendor behind Carbon's own provider interface.
3. **What do competitors sync and how do they post?** Consensus matrix: customers/vendors
   two-way or push; items push as non-posting types; SO→invoice and receipt→bill as native
   documents; payments pull or tri-state; COGS/adjustments/WIP as journal entries
   (per-transaction default, daily-summary option). See Consensus Patterns 1–3.
4. **Standard sync-engine architecture?** Outbox written transactionally with the business
   event; per-record state machine (pending → pushed → confirmed → failed) with recovery
   points; target-side external-ID idempotency; visible error inbox with retry/skip/re-send;
   delta cursors; scheduled reconciliation (document-level + aggregate). See Patterns 4–6, 9.
5. **qbXML coverage/limits for Carbon?** Everything needed is writable (customers, vendors,
   items incl. assemblies + builds, invoices, credit memos, sales orders, receive payments,
   bills, vendor credits, bill payments, POs, item receipts, journal entries, inventory
   adjustments, UoM, classes, custom fields). Limits: JE ≤1 AR/AP line with entity required;
   name-length caps (31/41); one currency per customer/vendor; RefNumber not unique; payroll
   read-only; error recovery via newMessageSetID. See the QBD surface section.
6. **QBD lifecycle → target QBO too?** Enterprise 24.0 is the terminal but actively-updated
   Desktop platform (no announced EOL, still sold); the fork is permanent — QBO/IES is a
   wholly different API. Yes: design the engine for both from day one; the QBO provider stub
   already exists and shares nothing with QBD but the brand.

## Competitor-Specific Details

### Fishbowl — the canonical QB Desktop manufacturing integration

- **Connection**: QB Desktop SDK (qbXML/COM) on the **same machine** as Fishbowl Server (QB
  single-user, dedicated "Fishbowl" QB user, "allow access even if QuickBooks is not running");
  LAN reach via their own `Fishbowl Nexus.exe` bridge on the QB machine. Their cloud product
  (Fishbowl Drive) supports **QBO only** — even Fishbowl never solved cloud→QBD.
- **Master data**: Fishbowl owns inventory/SOs/POs; QB keeps chart of accounts, AR/AP
  processing, payments. QB's own inventory + PO features are turned OFF. Items are **not
  mirrored 1:1** — exported documents use a single placeholder item `FB_Item` with the real
  part number in the line description; dollars are directed per-line to mapped accounts.
  Customers/vendors are created in QB lazily (on first exported order), matched by name;
  optional collapse-all to a generic `FB_Customer`.
- **Posting model (hybrid, per-transaction)**: ship/invoice SO → QB **Invoice** (Dr AR / Cr
  Income) **plus a separate Journal Entry** (Dr COGS / Cr Inventory Asset); receive PO → QB
  **Item Receipt**, then reconciling the bill in Fishbowl **creates the QB Bill and deletes
  the Item Receipt**; adjustments/cycle counts/scrap → per-event JEs to mapped accounts
  (Inventory Adjustment, Scrapped Inventory); work orders → **JEs only, no WIP account in QB**
  (labor/overhead move from mapped expense accounts into FG asset value at completion);
  standard-cost variance → required Cost Variance account. No period summarization (only
  POS-checkout sales-receipt batching).
- **Account mapping**: integration wizard forces mapping of a fixed set of **21 named
  accounts** (auto-create in QB or choose existing); defaults by part type + optional
  per-part/per-product account overrides.
- **Sync mechanics**: pull-the-trigger or scheduled-nightly export with three modes —
  **Standard** (everything completed since last successful export), **Repost** (date range;
  loud duplicate warning), **Mark as posted** (skip; irreversible). Pre-flight validation of
  referenced entities. Documented tie-out: point-in-time Asset Valuation by Account vs QB
  Inventory Asset balance ("can only be reconciled as of RIGHT NOW"); operating rule that the
  sync is the only writer to control accounts.
- **Known failure modes**: the unlinked Invoice + COGS-JE pair (a date edit in QB strands COGS
  in another period); Item-Receipt→Bill delete-and-replace choreography doubles payables if a
  human flips the receipt in QB; Accountant's Copy blocks all posting ("Dividing date error");
  closed-period rejects (QBO 6210) resolved by reopening period or irreversibly marking
  posted.

### MISys Manufacturing — subledger + batch Period End (the other QBD reference)

- **Connection**: QB Desktop SDK, QB installed **on the same machine** as each MISys client
  performing integration ops (briefly consumes one QB user license). QBO variant uses REST +
  OAuth2.
- **Split**: QB owns customers/sales/AR/AP/GL + finished-goods sales items; MISys owns raw
  materials, BOMs, WIP, production, purchasing. Item mapping is explicit and N:N with template
  items; GL accounts must pre-exist in QB with **exactly matching name+number** (checker +
  auto-create provided). QB Advanced Inventory (FIFO/serial-lot) must stay disabled.
- **Posting model (subledger + batch)**: every MISys transaction writes Dr/Cr pairs to an
  internal **Master Transaction Log** against **18 named "Accounting Controls"** (Inventory,
  WIP, PO Liability/GRNI, Purchase Price Variance, Sales Transfer Clearing…), flagged "Not
  Posted." **Period End** posts a chosen date range to QB as journal entries and flags rows
  Posted (the idempotency key); **consolidation level is configurable** (full detail ↔
  summarized). WIP reaches QB only via these JEs. Real-time native docs where payables must
  surface: PO Invoice → QB Bill; finished-goods "Transfer to Sales" → Bill + self-paying
  Vendor Credit through a clearing account against a special MISys vendor (works, but
  bewilders accountants — an anti-pattern to avoid). Job costing maps to auto-created QB
  Classes.
- **Account mapping**: default control-account set + named **overlay Account Sets** assignable
  to Job, Item, or Location, resolved **per control with fall-through Job → Item → Location →
  Default** — the cleanest override model observed, and exactly Carbon's flat-defaults+overrides
  doctrine.
- **Sync mechanics**: date-ranged batch with **Print Unposted** (review-before-post) and
  post-run subledger report; "Prior Journal Entries" checkbox sweeps stragglers. Failure mode
  to avoid: mid-Period-End failure requires **restoring both databases** (no per-entry
  recovery).

**Patterns to copy (synthesized from both):** hybrid posting (native AR/AP docs + JEs for
inventory economics); subledger with per-row posted-flag idempotency and date-ranged posting
runs with configurable consolidation; review-before-post preview; export-since-last-success
semantics with explicit Repost/Mark-as-posted escape hatches; pre-flight entity validation;
lazy JIT creation of customers/vendors; GRNI/clearing accounts for timing gaps; published
journal-entry catalog per event type; documented point-in-time tie-out procedure + "sync is
the only writer to control accounts" rule.

**Patterns to avoid:** two unlinked target transactions per business event without a shared
correlation key; delete-and-replace choreography; fake-vendor document contortions; irreversible
mark-as-posted; all-or-nothing batch failure requiring DB restore; no drift detection.

### Cloud MRP/inventory sync engines (Katana, Cin7 Core, Unleashed, SOS, MRPeasy, Fulfil)

**Katana (QBO + Xero; explicitly no QBD).** SO → invoice, PO → bill behind toggles; COGS
pushed as a **journal entry on delivery** (QBO only); items pushed as **non-inventory** items;
flat default-account pickers + one override dimension ("Accounts by Category"); tax-rate
mapping is mandatory before activation (non-US). Cautionary tale: the COGS/stock journal
engine was built for QBO and **never ported to Xero** (Xero users are told to make manual
monthly journals) — per-provider feature skew is what a generic posting engine prevents.

**Cin7 Core (ex-DEAR) — the reference implementation.**
- **Account Mapping** page: 1:1 mapping of ~11 named roles → provider accounts (Inventory
  Control, COGS, Tax Liability, Customer Credit, In-Transit, Unrealised FX, Inventory
  Discrepancy, Default Revenue, WIP, Supplier Deposits, Gift Card Liability; + GRNI/GINR if
  accrual mode). Per-product overrides for inventory/revenue/COGS accounts.
- **Documents vs journals**: invoices/credit notes → native Xero/QBO invoices (with a "Xero
  Invoice Status: Draft or Authorised" setting); COGS → manual journal per authorized shipment;
  assembly/disassembly → WIP journals (components → WIP on start, WIP → FG on complete); stock
  adjustments/stocktakes → journals vs Inventory Discrepancy.
- **Per-channel granularity**: each sales channel independently picks No sync / Individual /
  Consolidated (daily summary) for invoices and COGS — high-volume channels get summarized
  postings.
- **Payments**: tri-state config — bidirectional / pull-only / push-only.
- **Sync state machine** (Synchronization Report): per-record **Pending → Completed / Failed /
  Warning / Skipped**; Failed auto-retries each sync, Warning waits for human review, Skipped
  is permanent opt-out, Completed→Pending is the manual re-send lever. COGS Maintenance can
  **void (recall) prior COGS exports for a date range**.
- **Duplicates**: on ambiguous API failure (no response), Cin7 marks Completed anyway to avoid
  duplicates and relies on manual Completed→Pending recovery — at-most-once bias. Dependency
  ordering enforced (customer + items sync before their invoice).
- **Cutover**: Opening Balances + "Conversion date"; "Load historical transactions" (pull, ≤1
  yr) and "Export historical data" (push from chosen start date). Period locks: pre-flight
  warning icon on transactions dated before the Xero lock date / QBO closing date.

**Unleashed (Xero + QBO).** Real-time push on transaction completion; bills created on **goods
receipt** (not PO creation) with configurable target status; shipment/stocktake/re-cost/
assembly journals to mapped accounts; minimal mapping page (Sales, COGS, Stock-on-Hand) +
per-product/per-customer COGS override; **Export Data** page with per-transaction status,
error reasons, Export All retry, and a **variance report** vs provider balances. Stricter
invariant worth noting: a document left in Draft in Xero counts as a **variance** — sync isn't
"done" until the target doc is approved.

**SOS Inventory (QBO-only, "QBO owns the GL").** Two-way sync of masters and AR/AP docs; all
items non-inventory/service in QBO; shipment → COGS journal entry; "Post COGS to QuickBooks"
checkbox with documented duplicate-COGS failure mode if QBO inventory tracking is also on.
Sync machinery: auto-sync frequency, **Preview sync** (outbound queue with record removal),
Sync errors list, three-cycle grace before auto-correction.

**MRPeasy (QBO + Xero).** Cleanest two-layer split: (1) document sync — invoices/bills within
~5 min, auto-creating missing customers/items; (2) optional **daily balance-level journal
sync** — one summarized posting per day for inventory on hand, WIP (incl. labor + applied
overhead), and COGS. Summary journals make per-transaction idempotency concerns mostly vanish.

**Fulfil.io (closest structural analog to Carbon — own full GL).** Markets per-event real-time
JEs in its own ledger as superior to external sync; the outbound bridge is deliberately
**minimal and transitional**: push sales/purchase invoices to QBO/Xero "on a schedule for a
clean monthly close" during a migration year, plus inbound opening-trial-balance import at
go-live. Position: once the ops system has its own GL, external sync shrinks to AR/AP document
push for the accountant, not full ledger mirroring.

### SAP S/4HANA — external-posting interface (the enterprise reference)

- **Posting API + dry-run**: `BAPI_ACC_DOCUMENT_POST` with paired `BAPI_ACC_DOCUMENT_CHECK`
  (validate-before-post). Even SAP's dry-run is imperfect (some validations only fire on real
  post) — so real-post errors must be handled regardless.
- **Durable staging + error queue**: async path via `ACC_DOCUMENT` IDoc; failures land at
  status 51 in a reprocessing workbench (BD87) where ops can **edit the staged payload and
  replay**. Failed postings are never lost — per-record status, editable, replayable.
- **Idempotency via caller-owned reference key**: external system's identity travels in
  `OBJ_TYPE/OBJ_KEY/OBJ_SYS` → stored on the FI doc header (`BKPF-AWTYP/AWKEY`); dedupe and
  reversal both anchor on it. Reversal is `BAPI_ACC_DOCUMENT_REV_POST` **by reference to the
  original external key** — external documents are never edited/deleted in FI, only reversed
  through the interface by the originating system.
- **Summarization**: OBCY/TTYPV summarizes interface postings (to stay under FI's 999-line
  limit), but never merges debit with credit lines, and SAP pairs summarization with
  **drill-back reports** so a GL doc can always be explained by subledger items. Summarize
  forward, always drill back.
- **Account determination (OBYC)**: the maximal valuation-class × transaction-key matrix — the
  archetype Carbon deliberately simplifies from. Its real lesson: "no mapping found" must be a
  **pre-post validation error** in the pipeline, not a runtime surprise.
- **Reconciliation as a standing control**: control accounts + periodic consistency-check
  programs (SAPF190 etc.) comparing documents to balances; subledger↔GL reconciliation is
  scheduled, not incident-driven.

### NetSuite — the model sync target

- `externalId` on every record; REST `PUT /journalEntry/eid:{id}` is a true **idempotent
  upsert** — Oracle's own guidance for duplicate prevention. (Async REST also supports a
  `NetSuite-Idempotency-Key` header — secondary source only.)
- Closed periods reject integration writes; NetSuite's built-in remedy is a **preference**:
  "Default Posting Period When Transaction Date in Closed Period" = first open period (keeps
  the original transaction date). *Override Period Restrictions* bypasses **locked** but never
  **closed** periods.
- **Custom transaction types**: named, separately-permissioned journal-like documents so synced
  postings are visibly "from system X" rather than anonymous JEs — better auditability.

### iPaaS blueprints (Celigo / Workato / Boomi) — the ops UX bar

Consensus machinery across all three: a **per-record error inbox** (not logs) with
open/resolved/retry states, error message + payload, **edit-payload-and-retry**, bulk retry
(Celigo: up to 20k), **resolve-without-retry** (for things fixed manually in the target),
assignment/tags for triage, digest email notifications (~15 min), connection offline/online
alerts, and **delta cursors** (`lastExportDateTime`-style, advancing only on successful runs).
ID cross-referencing is bidirectional writeback (store target ID on source record and vice
versa) with an explicit flag to suppress writeback-triggered sync loops (Carbon's
`withTriggersDisabled()` is the same idea).

### Integration-engineering canon (applies directly to posting sync)

- **Transactional outbox** (microservices.io/Debezium): posting intent written in the same DB
  transaction as the journal; relay delivers at-least-once; target dedupes.
- **Stripe-style idempotency keys + per-record state machine** (brandur.org): key row stores
  params/result/**recovery point**; "once we make our first foreign state mutation… we
  shouldn't lose track of it"; background completers/reapers make it passively safe. Mapped to
  GL sync: `pending → pushed → confirmed → failed` lifecycle per posting.
- **Checkpointed replayable sync** (Airbyte/Fivetran): at-least-once + destination dedupe by
  key + cursor; idempotence as the failure-proofing primitive.
- **Continuous reconciliation** (Formance/Leapfin): three tiers — event-level matching by
  reference ID (catches missing docs), aggregate matching of per-period/per-account totals
  (catches drift), position matching of balances. Drift is expected whenever a local write
  succeeds but the downstream push fails; reconcile continuously.

### Period-close interaction — cross-vendor consensus

- SAP: park in error queue (BD87), human re-opens period or re-dates and replays.
- NetSuite: optional auto-post to first open period, preserving original transaction date.
- **Xero**: API rejects docs dated before the lock date ("document date cannot be before the
  period lock date"); org lock dates are queryable.
- **QuickBooks Online**: rejects writes into closed books AND **the API can neither read nor
  set the close date** — Intuit's official guidance is to capture the close date from the
  admin at connect time and pre-validate client-side.
- Consensus: never silently drop or silently re-date; either park-as-error with a remediation
  path (default) or an explicit per-connection "post to first open day, preserve original date
  in reference/memo" policy.

## QuickBooks Desktop Integration Surface (Primary-Source Findings)

Scope note: "Manufacturing & Wholesale" is an industry *flavor* of QB Desktop Enterprise 24.0
(same binary, industry menus/reports). Integration surface is identical to any US Enterprise
24.0.

### Mechanisms — definitively

- Exactly two sanctioned mechanisms, both funneling into the same XML request processor:
  1. **QB Desktop SDK** (`QBXMLRP2.dll` COM component, same machine/LAN): raw **qbXML** or the
     QBFC typed wrapper. Latest SDK = **16.0**; Enterprise 24.0 speaks qbXML ≤ **16.0**.
  2. **QuickBooks Web Connector (QBWC)**: Intuit's Windows app that acts as a SOAP **client**
     polling *your* HTTPS service and ferrying qbXML to the local request processor. **This is
     the only supported way for a cloud app to talk to QB Desktop.** Outbound HTTPS only
     (firewall-friendly); QBWC version 34.x for the QB 2024 line — maintained but functionally
     frozen (recent releases are cert renewals + a DNS fix).
- **No REST API, no webhooks, ever**: Intuit's hosted Desktop REST API + Sync Manager were
  discontinued March 1, 2016 and never replaced. The SDK's event subscriptions deliver to a
  local COM callback only — useless for cloud. Change detection = polling with
  `ModifiedDateRangeFilter`. All REST façades (Conductor, Codat, …) run QBWC or an equivalent
  local agent underneath.

### Auth — the OAuth answer

- **OAuth does not apply to QB Desktop at all.** OAuth2 + realmId + refresh tokens is
  exclusively QuickBooks Online. QBD needs no Intuit app registration; authorization is
  entirely local, two layers:
  1. **QBWC ↔ our server**: we issue a **.QWC file** (AppName, AppURL [must be HTTPS with a
     public-CA cert], AppSupport [same domain], UserName, **OwnerID** GUID [one per app],
     **FileID** GUID [stamped into the company file as a private DataExt on first connect],
     QBType, optional Scheduler/RunEveryNMinutes, AuthFlags [0x8 = Enterprise],
     UnattendedModePref, PersonalDataPref). The **password is NOT in the file** — the user
     types it into QBWC (encrypted into the registry); we issue it out-of-band. At runtime
     QBWC calls `authenticate(user, password)` → we return an opaque **session ticket** (the
     only credential) + optionally a company-file path / "none" / "nvu" / "busy".
  2. **App ↔ QuickBooks**: first connection triggers the **Application Certificate dialog** —
     only the QB Admin in single-user mode can grant access, including personal-data access
     and **unattended mode** ("Yes, always; allow access even if QuickBooks is not running").
     Grants live under Integrated Applications; revocable; enforcement via status codes
     (3261 sensitive data, 3301 interactive-only requests).

### QBWC protocol contract (what our SOAP service implements)

- Eight callbacks — `serverVersion`, `clientVersion`, `authenticate`,
  `sendRequestXML(ticket, strHCPResponse, companyFile, qbXMLMajorVers, qbXMLMinorVers)`,
  `receiveResponseXML(ticket, response, hresult, message) → int percentDone` (0–99 = loop,
  100 = done, negative = error), `connectionError`, `getLastError`, `closeConnection`.
  WSDL namespace MUST be `http://developer.intuit.com/`; parameter names are load-bearing.
- First `sendRequestXML` of a session carries HostQuery/CompanyQuery/PreferencesQuery results +
  the file's max qbXML version — version requests per client.
- Strictly serial request→response loop; **one update session at a time per company file**;
  user-controlled polling schedule (UI floor 1 min; QBWC must be running on the customer's
  Windows machine — it is NOT a Windows service). Design the server as a **per-company FIFO
  work queue**.
- Large queries: iterator pattern (`iterator="Start"`, `MaxReturned`, `iteratorID`,
  `iteratorRemainingCount`).

### qbXML coverage for Carbon's needs (Enterprise 24.0, spec ≤16.0)

- **All writable**: Customer/Vendor Add/Mod/Query, ItemInventory (with Income/COGS/Asset
  account refs), ItemNonInventory/Service/OtherCharge/Group, **ItemInventoryAssembly incl. BOM
  + BuildAssemblyAdd** (Premier/Enterprise), InvoiceAdd (line ItemRef, ClassRef, link to SOs),
  CreditMemoAdd, **SalesOrderAdd (Premier/Enterprise only)**, ReceivePaymentAdd (apply to
  invoices via AppliedToTxn/SetCredit or IsAutoApply), BillAdd, VendorCreditAdd,
  BillPaymentCheck/CreditCardAdd, PurchaseOrderAdd, ItemReceiptAdd, **JournalEntryAdd/Mod**,
  InventoryAdjustmentAdd (serial/lot 11.0+), TimeTrackingAdd, UnitOfMeasureSet, Class,
  DataExt custom fields.
- **JournalEntry constraints**: debits must equal credits; an A/R-account line requires a
  Customer, an A/P line requires a Vendor; **max ONE line per JE may post to an AR or AP
  account**; foreign-currency JEs restricted to one foreign currency (practitioner consensus).
- **NOT writable**: payroll (reports/queries + TimeTracking input only), attachments,
  bank feeds, some Enterprise Advanced-Inventory UI features (landed cost, pick-pack-ship
  actions). QB's own FIFO/serial-lot/EIR features conflict with external inventory sync
  (Fishbowl/MISys both require them off).
- **References & limits**: every `*Ref` takes ListID (opaque, stable — prefer; store it) and/or
  FullName (colon-joined hierarchy; exact punctuation match). Account name ≤31 chars/level;
  customer/vendor ≤41; RefNumber ≤11 on most txns and **uniqueness is NOT enforced via SDK**;
  requestID ≤50 chars. Multicurrency: transaction currency comes from the customer/vendor
  (fixed once used) → one QB name per currency; we set ExchangeRate.
- **Error semantics**: statusCode + statusSeverity (Info/Warn/Error) per response. The ones a
  sync meets: **3100** name not unique (names share ONE namespace across customer/vendor/
  employee/other), **3120** object not found, **3140** invalid reference, **3200** stale
  EditSequence (re-query, re-apply), **3175/3176** object in use / lock failed (retry-later
  family), **3170/3171** closing-date/condense lock, **3180** generic save failure (often
  transient), 3250 feature not enabled, 3260-series permissions. Connection failures are COM
  HRESULTs via `connectionError` (0x8004040A different file open, 0x80040401 can't access QB…).
  `onError="stopOnError|continueOnError"` per message set; **no rollback support**.
- **Idempotency**: `requestID` echo is correlation only. TRUE dedup across dropped connections
  = **qbXML error recovery**: send `newMessageSetID` (GUID) on every writing message set,
  persist until the response is processed; after a disruption ask with `oldMessageSetID` — QB
  stores the last message-set ID + response, so we learn whether writes landed and get the
  stored response instead of double-posting (mandated by the QBWC guide for web services).
  Belt-and-braces: stamp Carbon's document ID into RefNumber/Memo/DataExt and query-before-
  insert.

### Lifecycle reality (mid-2026)

- **Enterprise 24.0 is the current, terminal Desktop platform**: Intuit's Firm of the Future
  states Desktop Plus 2024 / Enterprise 24.0 "were the last annual platform releases" —
  Desktop moved to **continuous updates on the 24.0 platform** (R-releases, e.g. R21 June
  2026; feature drops like "October 2025 release"). **Enterprise 25.0/26.0 do not exist.**
  Enterprise is still sold to new customers (the Sept-2024 stop-sell hit only Pro/Premier/Mac).
  QB Desktop 2023 services died May 31, 2026; **Enterprise 24.0 has no announced end date**
  ("won't be discontinued in May 2027" per Intuit-adjacent coverage). SDK 16.0 + QBWC are
  maintained-but-frozen and remain the supported mechanism.
- **Rightworks hosting** ("Enterprise with cloud access"): same SDK/QBWC inside the hosted
  Windows desktop; QBWC installed from their app catalog, auto-start via their support.
- **Intuit Enterprise Suite (IES)** is a separate cloud product on the QBO platform — standard
  QBO API (OAuth2/REST/webhooks), one realmId per entity. A customer migrating QBD → IES
  switches to the QBO adapter entirely.

## Bridge / Build-vs-Buy Matrix (cloud → on-prem QB Desktop)

**The core fact:** there is exactly one Intuit-approved remote channel into QB Desktop — the
**QuickBooks Web Connector (QBWC)**, a Windows app next to QuickBooks that *polls YOUR HTTPS
SOAP service* and relays qbXML via COM. Every vendor option (Conductor, Codat, Merge, Rutter,
Apideck) is QBWC + qbXML under the hood. Build-vs-buy = who operates the SOAP service, the
qbXML translation layer, and the customer-support burden.

| Option | Effort | Ops burden | Mfg entity coverage | GL journals | Cost | Vendor risk | Customer install |
|---|---|---|---|---|---|---|---|
| **Build: self-hosted QBWC SOAP endpoint** | Very high (SOAP session state machine + qbXML layer per entity; no maintained Node OSS — `qbws`/`quickbooks-js` dead, only Ruby `qbwc` gem alive as of 2026-04) | High — we own QBWC support tickets (QBWC1085, restart-after-reboot, TLS certs, version handshake), encoding/field-limit quirks | Full qbXML surface, but we write every entity | Yes (JournalEntryAdd, we implement) | Engineering + support time | None (Intuit protocol, ~20 yrs stable) | Moderate: install QBWC, load .qwc + password, keep PC on (QBWC is NOT a Windows service) |
| **Conductor (conductor.is)** | Low — typed TS SDK (`conductor-node`, ~21k dl/wk, very active), REST, real-time request/response | Low — they own qbXML/QBWC/session layer + end-user error guides | **Best**: 130+ object types incl. sales orders, inventory adjustments, build assemblies, price levels, UoM sets | Yes — documented | **$49/mo per company file** (homepage, Jul 2026), volume tiers | Small startup, funding opaque; mitigated by **Ramp's QBD integration running on Conductor** | Low — guided auth-URL flow; Rightworks-hosted QBD supported |
| **Codat** | Medium | Medium — **batch sync windows only** (default nights; from 2026-01 even initial fetch waits) — not real-time | Broad canonical model; QBD-specific JE-push matrix unverifiable (docs moved) | Push in model; verify for QBD | Opaque; ~$24k/yr median (Vendr) | Medium-high — pivoted to commercial-banking intelligence; SaaS accounting API now secondary | Low-med — one .exe bundling QBWC + auto-run, auto-restarts (better than raw QBWC) |
| **Rutter** | Medium | Medium | Wide QBD read+write incl. POs and sales orders | Yes — JE GET/POST documented for QBD | Custom; est. $12–24k/yr platform + $30–50/connection/mo | Medium (fintech-focused; QBD one of 60+ platforms) | Low-med |
| **Merge.dev** | Medium | Medium | QBD connector exists; field-level coverage/JE writes publicly undocumented — confirm | Unverified | 3 free accounts; $650/mo ≤10; $65/account | Medium (big horizontal vendor; QBD is long-tail) | Low-med (QBWC linking flow) |
| **Apideck** | Medium | Medium | New 2026 connector, unproven in production | Claimed | Self-serve tiers | Medium (too new) | Low-med |
| **Transaction Pro / IIF (fallback)** | Trivial (we generate CSV/IIF) | Manual for customer each cycle | Lists + 20 txn types incl. JEs | Yes, manual; IIF JEs risky (no validation, **no undo**, lines re-sorted) | TPro license / IIF free | Low | High recurring manual effort |

**What comparable products chose:** Ramp → bought (Conductor). ServiceTitan → built its own
QBWC integration (and carries a whole support section for QBWC troubleshooting — the ops
tail). Fishbowl → co-located desktop software using the local SDK (not replicable for cloud).
Katana → refused to support QBD at all. Mosaic → discontinued QBD citing Intuit's desktop
phase-out. Autofy (a bridge many SaaS depended on) → **shut down June 2024, killing dependent
integrations overnight** — the canonical vendor-risk case study, and the argument for hiding
any bridge vendor behind Carbon's own provider interface so a swap is not a rewrite.

**QBD market reality (mid-2026):** Intuit stopped selling Pro/Premier to new US subscribers
Sept 2024, but **Enterprise is exempt and still sold**; QBD 2023 support ended May 31 2026;
Enterprise 24 support runs to ~May 2027 (one source says Sept 2027 — unverified). Roughly 17%
of US SMBs still on QBD; ~268k companies on Enterprise (secondary sources, directional).
Rightworks-hosted QBD has **no API of its own** — same Web Connector inside the hosted desktop,
so any choice must be (and Conductor/Codat are) Rightworks-compatible.

## Recommended Approach for Carbon

1. **Treat "QuickBooks" as two providers.** `quickbooks-online` (OAuth2/REST — the existing
   `ee/src/quickbooks/config.tsx` stub is already aimed here) and `quickbooks-desktop` (Web
   Connector transport). They share nothing but the brand (Intuit's own docs). Sequence QBO
   after the engine is generic — it's nearly free and the bigger funnel — but QBD is the
   differentiator (no modern cloud MRP serves it; Fishbowl's 21-account model is the incumbent
   to displace).

2. **Harden the existing core rather than rebuild** (it's already 70% of a sync engine):
   generalize `ProviderCredentialsSchema` beyond `oauth2` (add a `webconnector` variant:
   username, password hash, ownerId/fileId GUIDs, qbXML version); move tenant discovery,
   pagination, and date parsing fully behind the provider interface; apply per-company
   `syncConfig` (currently hardcoded to `DEFAULT_SYNC_CONFIG`); keep `ENTITY_DEFINITIONS`
   dependency-graph JIT sync (it mirrors Cin7's "customer + items before invoice" rule).

3. **Add the durable sync-run layer the canon demands** (SAP IDoc/BD87, Stripe/brandur,
   Celigo, Cin7): an outbox row written transactionally with the source change, per-record
   lifecycle `pending → pushed → confirmed → failed/skipped`, provider-agnostic **error inbox
   UI** (retry, edit-context-and-retry, skip, re-send, bulk actions — Cin7's status semantics),
   and idempotency keys stored on the mapping row. This is required for QBD (its transport is
   an inverted poll — QBWC drains our queue) and is the reliability/UX upgrade Xero sync needs
   anyway. REST providers drain the queue immediately via Inngest; QBD drains on QBWC poll (or
   synchronously via a bridge vendor).

4. **Posting sync = journal push for inventory economics + the existing document sync for
   AR/AP** (Consensus Pattern 1). Add a `journalEntry` entity type + syncer sourcing Carbon's
   **Posted** journals, filtered by `sourceType`: push journals for receipt/shipment-COGS/
   adjustment/production/variance events; do NOT push journals whose documents already sync
   (sales invoice, purchase invoice, payment) — that double-posts. Per-company consolidation
   setting: Individual (default) vs Daily summary per account (Cin7/MRPeasy). Reversals push
   as reversing entries referencing the original external key — never delete/edit in the
   target.

5. **Account mapping**: map Carbon `account.id` ↔ provider account via
   `externalIntegrationMapping(entityType='account')` (per `.ai/lessons.md`: external codes
   are legitimate only as mapping keys; resolve to Carbon account **id**). Settings UI = flat
   list of Carbon's named default roles + chart picker (the accounts route already fetches
   Xero's chart). **Pre-flight validation**: unmapped account, missing tax mapping, or
   locked-period date = a Warning/Failed row before push, not a provider error after.

6. **Period-close policy per connection** (Pattern 7): store the target's lock/close date
   (queryable for Xero; **manually captured for QBO** — its API can't read it; QBD rejects via
   statusCode 3170 closing-date lock), pre-validate, default **park-as-error**, optional
   "re-date to first open day, original date in memo/reference" (NetSuite pattern).

7. **QBD transport: rent first, isolate always.** Start with **Conductor** ($49/mo per company
   file, TypeScript SDK, real-time, journal entries + sales orders + inventory adjustments +
   build assemblies documented, Rightworks-compatible, powers Ramp) behind Carbon's own
   provider interface, so a later swap to a self-hosted QBWC endpoint (or Rutter) is a
   transport change, not a rewrite — the Autofy shutdown is the cautionary tale for naked
   vendor coupling. Self-hosting QBWC is viable in the Node stack later (the SOAP surface is
   8 methods; the cost is the qbXML entity layer + customer-side support tail: keep-PC-on,
   QBWC-not-a-service, QBWC1085, cert management). Decision gate: Conductor contract/DPA
   review + a spike proving JournalEntryAdd + InvoiceAdd round-trips.

8. **Positioning for QBD customers = "Carbon is ops, QuickBooks is the books"** (Fishbowl/
   MISys segment). Carbon's own GL keeps running (it is the subledger-of-record and the
   drill-back source, like MISys's Master Transaction Log); what syncs out is documents +
   value journals. Do 1:1 **non-inventory items** in QBD (Enterprise list limits are high;
   more legible than Fishbowl's FB_Item placeholder), QB inventory tracking OFF, documented
   as a setup prerequisite with an activation checklist (tax mapping, account mapping,
   conversion date — Pattern 8, aligning with cutover spec #1057).

9. **Reconciliation job** (Pattern 9): scheduled comparison of per-account/per-period totals
   (Carbon GL vs provider trial balance) + external-ID presence checks, surfacing drift in the
   integration UI (Unleashed's variance report). Operating rule in docs: the sync is the only
   writer to mapped control accounts.

10. **Sequencing**: (A) engine hardening + sync-run/outbox layer + error inbox; (B) posting
    sync shipped **on Xero first** (REST, already-live provider — proves account mapping,
    journal push, consolidation, reconciliation); (C) QBO provider (reuses OAuth infra +
    document/journal syncers); (D) QBD provider via Conductor (entity sync + posting), with
    the self-host QBWC option held in reserve. Avoid Katana's fate (a posting engine built
    for one provider and never ported) by keeping every posting feature in the core, not the
    provider.

## Open Questions (carried to the spec)

1. **Build vs rent the QBD transport** — recommendation: rent (Conductor) behind our
   interface; needs Brad's sign-off (production dependency + per-file cost).
2. **Scope of "QB owns the books" mode** — for QBD/QBO customers, does Carbon suppress its own
   AR/AP-close workflows (Fulfil's minimal-bridge stance) or run full parallel books with
   document sync? Recommendation: full Carbon GL stays on; sync is outbound-only for
   journals + two-way for AR/AP documents per existing `DEFAULT_SYNC_CONFIG` owners.
3. **Default consolidation granularity** — per-transaction (Cin7/Fishbowl) vs daily summary
   (MRPeasy). Recommendation: per-transaction default, per-company toggle.
4. **Item representation in QBD** — 1:1 non-inventory items (recommended) vs Fishbowl-style
   placeholder item; affects invoice legibility in QB.
5. **Employee/time sync** — TimeTrackingAdd exists in qbXML; in scope for payroll-adjacent
   customers or deferred?

## Sources

**Intuit primary (QBD surface, auth, lifecycle)**
- QBWC Programmer's Guide: https://static.developer.intuit.com/qbSDK-current/doc/pdf/QBWC_proguide.pdf
- QBWC release notes (34.x / 33.x): https://static.developer.intuit.com/resources/quickbooksWebconnector/QBWC_ReleaseNotes_34_R0_1001_27.pdf · https://static.developer.intuit.com/resources/quickbooksWebconnector/QBWC_ReleaseNotes_33_R0_10015_91.pdf
- SDK 14/15 release notes: https://static.developer.intuit.com/resources/ReleaseNotes_QBXMLSDK_14_0.pdf · https://static.developer.intuit.com/resources/ReleaseNotes_QBXMLSDK_15_0.pdf
- SDK download/compatibility: https://developer.intuit.com/app/developer/qbdesktop/docs/get-started/download-and-install-the-sdk · https://developer.intuit.com/app/developer/qbdesktop/docs/get-started/sdk-compatibility-with-quickbooks-releases
- Get started with QBWC: https://developer.intuit.com/app/developer/qbdesktop/docs/get-started/get-started-with-quickbooks-web-connector
- Status codes appendix: https://developer.intuit.com/app/developer/qbdesktop/docs/develop/exploring-the-quickbooks-desktop-sdk/status-codes-in-response-messages
- Iterators: https://developer.intuit.com/app/developer/qbdesktop/docs/develop/exploring-the-quickbooks-desktop-sdk/query-requests-and-responses
- Objects/operations list: https://developer.intuit.com/app/developer/qbdesktop/docs/additional-reference/quickbooks-objects-and-operations-accessible-with-the-sdk
- Assembly/BuildAssembly tutorial: https://developer.intuit.com/app/developer/qbdesktop/docs/develop/tutorials/the-assemblyitem-and-buildassembly-requests
- Multicurrency tutorial: https://developer.intuit.com/app/developer/qbdesktop/docs/develop/tutorials/using-the-multicurrency-feature-with-the-sdk
- Desktop REST/Sync Manager discontinuation: https://blogs.intuit.com/blog/2015/12/03/3-months-to-go-timeline-to-discontinue-the-quickbooks-desktop-rest-api-and-intuit-sync-manager/
- Stop-sell + service discontinuation policy: https://quickbooks.intuit.com/learn-support/en-us/help-article/new-subscriptions/us-quickbooks-desktop-sold-july-2024/L5lkQNq7L_US_en_US · https://quickbooks.intuit.com/learn-support/en-us/help-article/feature-preferences/quickbooks-desktop-service-discontinuation-policy/L17cXxlie_US_en_US
- Continuous-release model (last annual release): https://www.firmofthefuture.com/product-update/quickbooks-desktop-improvements/
- Field length limits: https://quickbooks.intuit.com/learn-support/en-us/help-article/printing-preferences/character-limitations-fields-quickbooks/L7eIy5gE3_US_en_US
- Rightworks hosting: https://quickbooks.intuit.com/learn-support/en-us/help-article/login-password/right-networks-hosting/L8jM0SDDj_US_en_US · https://helpdesk.rightworks.com/s/article/QuickBooks-Web-Connector
- IES API stance: https://blogs.intuit.com/2024/11/25/common-questions-about-building-apps-for-intuit-enterprise-suite/
- QBO closed-books API behavior: https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/handling-common-errors
- JE AR/AP line rule: https://tprosupport.rightworks.com/kb/article/627-validation-error-indicated-failed-object/

**Bridges / build-vs-buy**
- Conductor: https://conductor.is/ · https://docs.conductor.is/overview/quickstart · https://docs.conductor.is/llms.txt · https://github.com/conductor-is/quickbooks-desktop-node · https://docs.conductor.is/help/guides/rightworks
- Ramp × Conductor: https://support.ramp.com/hc/en-us/articles/35796967214611-QuickBooks-Desktop-FAQs-about-Conductor-partner
- Codat QBD: https://docs.codat.io/integrations/accounting/quickbooksdesktop/accounting-quickbooksdesktop · https://docs.codat.io/updates/251006-deprecation-quickbooks-desktop-changes-to-sync-schedule
- Merge QBD: https://www.merge.dev/integrations/quickbooks-desktop · https://www.merge.dev/pricing
- Rutter QBD: https://docs.rutter.com/rest/2023-03-14/platforms/quickbooks_desktop
- Apideck QBD + build guide: https://www.apideck.com/integrations/quickbooks-desktop · https://www.apideck.com/blog/build-an-integration-with-quickbooks-desktop-in-2025
- Autofy shutdown: https://help.onpay.com/hc/en-us/articles/360038938631-Autofy-integration-services-discontinued-June-30-2024
- OSS QBWC servers: https://github.com/qbwc/qbwc · https://github.com/johnballantyne/qbws · https://github.com/RappidDevelopment/quickbooks-js · https://www.npmjs.com/package/soap
- QBWC error zoo: https://quickbooks.intuit.com/learn-support/en-us/help-article/open-programs/fix-common-web-connector-errors-quickbooks-desktop/L9slolvg0_US_en_US
- IIF fallback: https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/export-import-edit-iif-files/L56LT9Z0Q_US_en_US
- ServiceTitan build example: https://help.servicetitan.com/docs/quickbooks-desktop-1

**Fishbowl / MISys**
- Fishbowl QBD integration (archived official wiki): http://web.archive.org/web/20201028154023/https://www.fishbowlinventory.com/wiki/QuickBooks (live: https://help.fishbowlinventory.com/advanced/s/article/QuickBooks)
- Fishbowl Accounting Journal Entries: http://web.archive.org/web/20210726021144/https://www.fishbowlinventory.com/wiki/Accounting_Journal_Entries
- Fishbowl reconciliation tie-out: https://fishbowlhelp.com/files/Reconciling-Discrepancies.pdf
- Fishbowl Drive = QBO-only: https://quickbooks.intuit.com/app/apps/appdetails/fishbowl_drive/en-us/
- Fishbowl failure modes: https://blog.tarabyte.com/blog/the-top-10-reasons-fishbowl-and-quickbooks-dont-match · https://blog.tarabyte.com/blog/the-easy-way-to-double-your-payables
- MISys QBD FAQ (posting model, control accounts): https://misysinc.com/quickbooks/faqs-for-quickbooks/
- MISys accounting architecture: https://helpdesk.misysinc.com/knowledgebase.php?article=40 · account sets: https://helpdesk.misysinc.com/knowledgebase.php?article=41 · Period End: https://helpdesk.misysinc.com/knowledgebase.php?article=66

**Cloud MRP engines**
- Katana QBO config: https://support.katanamrp.com/en/articles/9447704-how-to-configure-the-quickbooks-online-integration · Xero stock gap: https://support.katanamrp.com/en/articles/5968138-how-to-sync-stock-to-xero-from-katana
- Cin7 Core account mapping: https://help.core.cin7.com/hc/en-us/articles/9034463858831-Accounts-and-Chart-of-Accounts · sync report: https://help.core.cin7.com/hc/en-us/articles/9034605172879-Xero-Synchronization-Report · consolidation: https://help.core.cin7.com/hc/en-us/articles/9735460166543-Consolidate-transactions-for-QuickBooks-Online · errors/locks: https://help.core.cin7.com/hc/en-us/articles/13625639249807-QuickBooks-Online-errors · conversions: https://help.core.cin7.com/hc/en-us/articles/9034487616015-Manage-Opening-Balances-Conversions
- Unleashed Xero setup + reconcile: https://support.unleashedsoftware.com/hc/en-us/articles/4402418327961-Xero-Integration-Setup · https://support.unleashedsoftware.com/hc/en-us/articles/5029216195481-Reconcile-with-Xero-and-export-transactions
- SOS Inventory sync: https://help.sosinventory.com/v8-quickbooks-online-integration-and-connection-overview · https://help.sosinventory.com/v8-sync-menu
- MRPeasy: https://www.mrpeasy.com/quickbooks/ · https://www.mrpeasy.com/xero/
- Fulfil: https://www.fulfil.io/products/general-ledger/ · https://www.fulfil.io/blog/when-fulfil-accounting-make-sense/

**SAP / NetSuite / iPaaS / canon**
- BAPI_ACC_DOCUMENT_POST + CHECK: https://sapficoblog.com/bapi_acc_document_post-accounting-document-in-sap/ · https://community.sap.com/t5/application-development-discussions/bapi-acc-document-check/m-p/10397821
- IDoc reprocessing (BD87): https://community.sap.com/t5/technology-blog-posts-by-members/how-to-use-transaction-bd87-to-reprocess-failed-idocs/ba-p/13641328
- AWKEY idempotency + reversal: https://community.sap.com/t5/application-development-and-automation-discussions/bapi-acc-document-post-awkey/m-p/5178751 · https://community.sap.com/t5/technology-q-a/reversing-a-document-using-the-bapi-bapi-acc-document-rev-post/qaq-p/1134828
- FI summarization (OBCY): https://wiki.scn.sap.com/wiki/display/ERPFI/Summarization+functionality
- OBYC account determination: https://erpcorp.com/sap-controlling-blog/fundamentals-of-mm-fi-account-determination
- NetSuite externalId upsert: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156334828635.html · https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156335203191.html
- NetSuite period behavior: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4334084139.html
- Celigo error management: https://docs.celigo.com/hc/en-us/articles/16182564553371-Retry-or-resolve-errors · Boomi retries: https://help.boomi.com/docs/Atomsphere/Integration/Process%20building/r-atm-Try_Catch_shape_7b3dd8df-426e-4ed7-824a-40cc0b5dc68d
- Outbox pattern: https://microservices.io/patterns/data/transactional-outbox.html
- Stripe idempotency: https://stripe.com/blog/idempotency · https://brandur.org/idempotency-keys
- Reconciliation tiers: https://www.formance.com/blog/financial-operations/account-reconciliation-patterns-for-high-volume-fintech
- Xero lock dates: https://central.xero.com/s/article/Set-up-and-work-with-lock-dates

**Flagged unverified**: exact qbXML-16.0↔QB-2024 matrix row (inferred from release-notes
pattern; Intuit SPA wouldn't render); one-foreign-currency-per-JE SDK rule (practitioner
consensus); Enterprise 24 end-of-support date claims (conflicting secondary sources; Intuit
has announced none); Conductor funding; Codat QBD-specific JE-push matrix; Merge QBD
field-level coverage.
