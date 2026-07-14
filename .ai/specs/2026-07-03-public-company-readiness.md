# Public-Company Readiness: Compliance Gap Audit & Remediation Program

> Status: in-progress (all open questions resolved 2026-07-03)
> Author: Claude (Big-4-style readiness assessment), for brad@carbonos.dev
> Date: 2026-07-03
> Research: `.ai/research/public-company-compliance.md`
> Baseline: this branch's six in-flight specs (period closing, financial reporting, multi-jurisdiction tax, budgeting, bank reconciliation, Plaid feeds) plus all previously implemented specs — treated as done

## TLDR

This spec is a readiness audit of Carbon's accounting platform against the requirements of a US-listed (or dual-listed) manufacturer operating in multiple countries, plus the remediation program to close the remaining gaps. The audit assumes every existing and in-flight spec is implemented as written — including this branch's period-closing lifecycle (hard close with a DB trigger backstop), multi-jurisdiction tax (tax subledger, corrected posting, returns, Avalara), financial reporting (cash flow, computed RE/Net-Income split, comparatives, GL detail, exports), budgeting (BvA, commitments, budget control), and bank reconciliation with Plaid feeds. That baseline eliminates three of the five findings that would otherwise be material weaknesses. **Two remain at material-weakness level**: posted accounting records are mutable in open periods and excluded from the audit log (which is itself opt-in, 30-day, and tamperable), and there is no journal-entry approval or segregation of duties anywhere — self-approval is possible in the one approval engine that exists. Beyond those: significant deficiencies (draft journals in reported balances, no DB-level double-entry enforcement, non-gapless editable numbering, FX/consolidation completeness, ITGC), GAAP capability build-outs (revenue recognition, leases, inventory valuation completeness, multi-book ledgers, segments), multi-country statutory machinery (e-invoicing, SAF-T/FEC exports, withholding/Intrastat), the ecosystem integration surface (TB/JE APIs, controlled JE import), and a vendor-level assurance program (SOC 1 Type II). The remediation is phased so the two remaining control keystones — immutable journals and JE approval — land first: they are the cheapest differentiators, the first things a SOX readiness firm tests, and the foundation every later phase posts into.

## Problem Statement

Carbon's goal is to be the accounting system a CFO adopts at seed and never leaves — through Series C, IPO readiness, and life as a public multi-national. The market evidence (research §Ecosystem) says this is winnable: companies graduate from QuickBooks/Xero at ~$5–30M revenue triggered by multi-entity consolidation, rev-rec spreadsheets, and inventory complexity (Carbon's manufacturing customers hit the inventory trigger earliest), and companies that reach NetSuite-class systems essentially never leave below $500M revenue — they IPO on them. Carbon already has unusually strong bones: company groups with subsidiary hierarchies, intercompany matching/eliminations with elimination entities, IAS 21-style translation with per-account rate types, a dimension-driven GL (the modern Intacct-style architecture), AR/AP settlement with tie-out RPCs, fixed assets with book + MACRS tax depreciation — and, with this branch, a real period-close lifecycle, a tax subledger, the full statements package, budgeting with commitment control, and bank reconciliation.

But the audit fieldwork (nine research workstreams, 2026-07-03; inventories cited per finding below) shows the record-integrity and approval layer that makes the ledger *auditable* is still missing, several GAAP-required subsystems do not exist, and multi-country statutory compliance beyond indirect tax is unstarted. A public-company client on the post-branch baseline would still fail SOX 404(b) on the two remaining control fronts in year one.

**Baseline for this audit** — the following are treated as done and their fixes are NOT re-reported as findings:

| Assumed implemented | What it resolves |
|---|---|
| `.ai/specs/2026-07-02-period-closing.md` (+ migration `20260702044133`) | Hard period close: Open → Locked → Closed with a SECURITY DEFINER trigger backstop binding all writers incl. service role; sequential close / reverse-sequential reopen; fiscal-year identity; computed close-readiness checklist (draft journals, unposted docs, negative inventory, unmatched IC, TB balance); reversal-dating across the boundary; audited transitions |
| `.ai/specs/2026-07-03-multi-jurisdiction-tax.md` | The tax misstatement (revenue net of tax; per-component tax payable/receivable posting), tax codes/components/authorities/registrations, immutable `taxLedger`, exemption enforcement, reverse charge + US use tax, memo tax, liability report, returns with settlement + AP remittance, return layouts (UK 9-box seeded), Avalara connector, Xero tax mapping |
| `.ai/specs/2026-07-02-financial-reporting.md` | Cash flow statement (single + consolidated with FX-effect plug), Retained Earnings / Net Income split (virtual year-end — the chosen model; no closing entries by design), comparative columns with variance, GL detail report + journal drill-down (Posted+Reversed by default), four-column trial balance, CSV export everywhere, PDF statements package, fiscal-period picker, saved report views |
| `.ai/specs/2026-07-02-budgeting.md` | Budget headers/lines (account × period × cost center), matrix editor, CSV round-trip, Budget vs Actual with hierarchy rollup, PO commitments, Warn/Block budget control with audited override, Approved-budget immutability trigger, income-statement budget columns, consolidated BvA |
| `.ai/specs/2026-07-02-bank-reconciliation.md` + `2026-07-02-plaid-bank-feeds.md` | Bank account master (1:1 GL link, FX + credit-card accounts), statement ingestion (CSV/OFX/BAI2/MT940/CAMT.053 + Plaid feed), matching engine + rules, tolerance adjustments, reconciliation close-out with difference-must-be-zero gate and optional **preparer→approver workflow**, PDF reconciliation report, daily cash position/drift; adds nullable `journalLine.sourceAmount`/`sourceCurrencyCode` populated where the poster knows its currency |
| `.ai/specs/2026-07-02-exchange-rate-convention-normalization.md` | GL base amounts on divide-to-base convention; phantom PPV on FX invoices; realized FX gain/loss signs; remittance currency labels; tie-out RPC rates |
| `.ai/specs/implemented/memo-refactor-plan.md`; invoice/payment audit Tiers 1–2 (`.ai/runs/2026-07-02-invoice-payment-audit.md`); `.ai/specs/2026-07-02-account-ledger-drilldown.md`; `.ai/specs/2026-07-02-work-order-stitching.md` | Memo model + journal shapes; AR stranding / invoice-tax / WIP fixes; report drill-down + period selector; production-side stitching |

Findings below only cover what remains beyond that baseline. Where a finding builds on or is narrowed by one of these, it says so.

---

## Findings

Severity scale (ICFR framing): **MW** = would likely be assessed a material weakness (reasonable possibility of material misstatement not prevented/detected); **SD** = significant deficiency; **GAP** = capability absent — becomes a deficiency the moment the client has the underlying transaction type; **CO** = company/vendor-level program, not product code.

### A. Control environment (ICFR core)

#### MW-1 — Posted accounting records are mutable in open periods and not audit-logged

**Condition.** (a) `journal` UPDATE RLS allows updates while status is Draft **or Posted** with `WITH CHECK (true)` — any `accounting_update` user can rewrite a posted journal's header (description, and postingDate within the same open period) via PostgREST (`20260402000000:84-92`). The period-closing trigger protects **closed** periods only — posted journals in open and locked periods remain mutable, and `journalLine` rows are only protected while the parent is Draft (nothing blocks service-role line edits on Posted journals). (b) `payment` UPDATE policy has no status condition (Posted-payment immutability is app-layer only, per the migration's own comment); `purchaseInvoice` RLS DELETE checks permission but not status. (c) The audit-log system is **opt-in per company (default off)**, retains 30 days hot, has a fully permissive `USING (true)` policy on its own tables, writes asynchronously through a queue (loss on pipeline failure), and its 26-entity coverage **excludes** `journal`, `journalLine`, `account`, `accountingPeriod`, `payment`, `memo`, `sequence`, `userPermission`, `apiKey`, and the approval tables. (The period-closing and budgeting specs both route their transition audit through this same system — their audit trail inherits these weaknesses.) (d) `journalLine` has no `createdBy`; `journal` has no preparer/approver identity.
**Criteria.** AS 2401 requires a complete, tamper-evident JE population with preparer/approver/timestamps; Germany GoBD requires Unveränderbarkeit; France FEC requires a sequentially complete extract on 15 days' notice; NetSuite System Notes / SAP change documents are the reference bar. One schema investment covers all four regimes (research §Pattern 1).
**Risk.** No auditor can rely on the ledger as evidence; fraud-testing analytics (backdating, off-hours, admin postings) are impossible; GoBD/FEC non-compliance in DE/FR entities; the period close's own audit trail can be silently edited or lost.
**Remediation (build).** *(Items 1–2 for `journal`/`journalLine` are folded into the period-closing spec §Enforcement item 4 as of 2026-07-03 — same trigger wave; the rest remains Phase 0.)* (1) DB triggers making posted `journal`/`journalLine`/`payment`/`memo`/`invoiceSettlement` rows immutable in **all** period states — the only permitted transitions are status-only (`Posted → Reversed/Voided` with linkage columns); SECURITY DEFINER, binding service role, following the period-close trigger precedent. (2) Add `journalLine.createdBy`; add `preparedBy`/`approvedBy` to `journal` (populated by MW-2's workflow). (3) Accounting audit coverage: extend `audit.config.ts` to the excluded tables above and make audit logging **always-on and non-disablable for accounting entities** (the company toggle keeps governing operational entities only); write accounting audit rows **synchronously in the posting transaction** (or transactional outbox) rather than via PGMQ. (4) Lock the audit tables down: append-only policies, revoke UPDATE/DELETE, configurable retention with a floor of 7 years for accounting entities (30-day default stays for operational noise). (5) Full-population **JE export** (flat CSV/JSON, no row caps: journal id, line, account, signed amount, debit/credit presentation, posting date, created/posted timestamps, preparer, approver, source type, document reference, reversal linkage, currency + source amount, book) — this single export is the SOX/FEC/SAF-T/GoBD workhorse and the substrate for GAP-D3.

#### MW-2 — No journal-entry approval, no segregation of duties, self-approval permitted

**Condition.** Manual journals go Draft → Posted with no approval step (`journalEntryStatus` has no pending state). The generic approval engine (`approvalRequest`/`approvalRule`) covers only `purchaseOrder`, `qualityDocument`, `supplier`; journals, payments, and invoices have none. `canApproveRequest` never excludes `requestedBy` — **self-approval of POs is possible today**, and the budgeting spec's Block-override and the bank-rec spec's preparer→approver reconciliation flow are the only SoD-shaped controls anywhere (the latter optional, reconciliation-only). The permission model (module × CRUD) cannot express preparer ≠ approver; no SoD conflict detection exists (repo-wide grep); `salesOrderStatus` contains a dead `'Needs Approval'` value nothing sets.
**Criteria.** Auditors specifically test whether submitter and approver credentials match (AS 2401 fraud procedures); SAP parks journals until workflow approval with requester ≠ approver enforced; NetSuite JE approval routing is standard pre-IPO configuration; a documented SoD matrix over roles is an ITGC prerequisite.
**Risk.** Management-override risk is uncontrolled; every manual JE is a fraud-testing exception; SOX readiness assessment fails at the first control tested.
**Remediation (build).** (1) Extend `approvalDocumentType` to `journalEntry`, `payment`, `purchaseInvoice` (and wire the dead sales-order status or remove it); journal state machine becomes `Draft → Pending Approval → Posted` when a matching rule exists, with amount/account-class routing reusing `approvalRule` tiers. (2) System-enforced **no-self-approval** in `canApproveRequest` (server-side, all document types, config flag defaulted on). (3) `journal.preparedBy`/`approvedBy` stamped from the request. (4) SoD v1 = detective: a conflict-matrix report over `userPermission` (canonical conflicts: vendor-create + payment-post; JE-create + JE-approve; sequence-edit + posting; bank-rec preparer + JE-post) plus a point-in-time **user access report** (per-user permissions by company, with grant history from the audit log) for quarterly access reviews. Preventive SoD enforcement is a later phase.

### B. Significant deficiencies

#### SD-1 — Statement integrity: drafts in reported balances, no DB-level double-entry enforcement

**Condition.** The balance RPCs behind the trial balance, balance sheet, and income statement **intentionally include Draft journals** (`20260702122210_journal-lines-view.sql:5-6`); the financial-reporting spec excludes drafts from the new GL detail report and the period-closing readiness check blocks *closing* on open drafts, but the statements a controller reviews mid-period still move with unapproved drafts — and become IPE the moment they're handed to an auditor. Separately, debits=credits is asserted only in app code (manual-JE service, payment builder); the invoice/receipt/shipment/production posters have **no balance assertion at all**, and nothing at the DB guarantees a journal balances.
**Criteria.** A trial balance that includes unapproved drafts cannot serve as IPE; a balanced-journal constraint is table stakes in every reference system; auditors roll the JE population forward opening→closing TB and any unbalanced journal breaks the identity the financial-reporting spec's cash flow tie-out also depends on.
**Remediation (build).** (1) Reports default to **Posted-only** with an explicit "include drafts" preview toggle — *folded into the financial-reporting spec §11 as of 2026-07-03* (`p_include_drafts DEFAULT FALSE` on both balance RPCs). (2) DB-level balance enforcement: deferred constraint trigger asserting Σ(signed amounts) = 0 per journal at COMMIT (0.01 tolerance), covering every poster including edge functions — remains Phase 0.

#### SD-2 — Numbering and dating are not audit-grade

**Condition.** `journalEntryId` comes from the app-level `sequence` table — not gapless (failed transactions leave holes), and the `sequence` table is **editable by any `settings_update` user** (next-number can be rewound → duplicate/reused numbers), with sequence changes not audit-logged. Invoice numbering likewise has no legal-series concept (gapless per series is law across most of the EU/LatAm; Portugal additionally requires ATCUD + hash chaining). Manual-JE backdating within open periods is unrestricted and unflagged.
**Remediation.** Gapless posting-time numbering: assign the final `journalEntryId` (and legal invoice numbers) inside the posting transaction from a DB-serialized per-company (per-series) counter; make `sequence` rows for accounting documents immutable-after-first-use and audit-logged; add `legalSeries` on customer-facing documents (per entity + country + document type) as the substrate for GAP-D2 e-invoicing; flag backdated entries (postingDate ≪ createdAt) in the JE export.

#### SD-3 — ITGC gaps: authentication, deprovisioning, environments

**Condition.** No MFA and no SAML/OIDC SSO (magic link + Google/Azure OAuth + passkeys only); deactivation does not revoke live sessions (no `auth.admin.signOut` anywhere); no idle timeout; API keys impersonate their creator and are excluded from audit logging; `getCarbonServiceRole()` bypass is convention-gated; deploys go main → prod with no staging tier; `pnpm audit` non-blocking; no CODEOWNERS.
**Remediation.** MFA enforcement policy per company (TOTP + passkey step-up), SAML/OIDC SSO (enterprise gate), session revocation on deactivate + admin session listing, API-key usage audit events, staging environment in the deploy pipeline, CODEOWNERS for `packages/database` + posting functions. (Vendor-side SOC 1 controls in CO-1 depend on these.)

#### SD-4 — FX completeness (beyond the convention-normalization and bank-rec specs)

**Condition.** With the FX spec implemented, realized FX and base-amount magnitudes are correct, and the bank-rec spec adds nullable `journalLine.sourceAmount`/`sourceCurrencyCode` populated "where the poster knows its currency." Remaining: population is best-effort, not universal (FEC/SAF-T and remeasurement need transaction currency on **every** line); there is **no unrealized FX revaluation** of open AR/AP/bank at period end (comment in `build-payment-journal.ts` confirms FX only realizes at settlement — and the period-closing spec's readiness checklist has no FX-revaluation task because the capability doesn't exist); historical-rate memory is a single value per currency (no per-transaction historical rates for equity/assets).
**Criteria.** ASC 830/IAS 21 require period-end remeasurement of monetary items with gains/losses in income; SAP FAGL_FCV / NetSuite "Revalue Open Foreign Currency Balances" is a standard close task (research §Pattern 5).
**Remediation.** (1) Make `sourceAmount`/`sourceCurrencyCode` mandatory outputs of every posting path (base `amount` stays authoritative) — *folded into the bank-reconciliation spec's FX section as of 2026-07-03*. (2) Unrealized-revaluation close task: revalue open FX invoices, unapplied payments/memos, and FX bank balances at the period-end rate, posting auto-reversing entries to new `unrealizedExchangeGain/LossAccount` defaults; posts as an *accounting* source under the period-closing matrix and joins the close-readiness checklist. (3) Historical-rate table keyed by account/transaction where `account.consolidatedRate = 'Historical'` demands it.

#### SD-5 — Consolidation correctness and completeness

**Condition.** `exchangeRateHistory` — the source of closing/average rates for `translateTrialBalance` and the financial-reporting spec's consolidated cash flow — has **no writer** (the daily job updates `currency.exchangeRate` only; the migration comment "auto-populated by sync job" describes a job that does not exist). Unless rows are inserted by hand, translation silently falls back to rate 1, so translated/consolidated statements for any multi-currency group are wrong today — the financial-reporting spec itself flags "sparse exchangeRateHistory" as a risk without fixing the source. CTA is a display-time plug applied to hardcoded account number "3200" (`balance-sheet.tsx:80,160`; the `currencyTranslationAccount` default exists but is unread — violating the repo's own control-account lesson, also flagged as a follow-up in the financial-reporting spec); CTA never posts or rolls forward. Translated income statements are life-to-date (the translate RPC lacks `netChange`). IC matching is exact-amount with no tolerance and no FX-difference handling; consolidation is 100%-summation (no ownership %/NCI); no group close lock.
**Remediation.** (1) Extend the daily exchange-rate job to append `exchangeRateHistory` (closing) and derive period averages; surface rate-coverage warnings on consolidated reports instead of the silent rate-1 fallback. (2) Post CTA to the configured `currencyTranslationAccount` (resolved by id) as part of group close; CTA rolls forward as a real balance. (3) Teach `translateTrialBalance` `netChange`. (4) IC matching tolerance + FX-difference posting to a dedicated difference account; IC document mirroring (PO↔SO) and netting later. (5) Ownership %/NCI deferred until sub-100% subsidiaries are a real customer need (SAP-tier; NetSuite also does 100% summation).

#### SD-6 — Master-data change controls

**Condition.** `accountDefault` (the entire GL account resolution layer), payment terms, tax codes/components (post-tax-spec: the rates that drive every tax posting), and counterparty tax data are editable by anyone with module update permission, with most of it outside audit-log coverage. Supplier bank details still don't exist anywhere (the bank-rec spec adds *company* bank accounts only) — but when AP payment execution arrives, unaudited vendor bank-detail changes are the #1 fraud vector.
**Remediation.** Audit-log coverage (MW-1) for `accountDefault`, `paymentTerm`, `taxCode`/`taxCodeComponent`, `customerTax`/`supplierTax`, `bankAccount`, sequences; approval-workflow option on supplier bank-detail changes (extends MW-2's engine) the moment vendor bank details exist; change-alert notifications to accounting owners.

### C. GAAP capability build-outs

#### GAP-1 — Revenue recognition (ASC 606 / IFRS 15)

Revenue is recognized in full at sales-invoice posting (net of tax once the tax spec lands, but still point-in-time); the seeded Deferred Revenue account has no writer; no schedules, obligations, POC, milestone/progress billing, or customer deposits. For Carbon's manufacturing base, the v1 cut that matters is: **deferred revenue schedules** (invoice → schedule → monthly recognition journal, posting as an *accounting* source and joining the close-readiness checklist), **customer deposits/prepayments** (liability until shipment), and **over-time recognition for long-lead contracts** (cost-to-cost POC using the job-costing data Carbon already has — a genuine differentiation vs the AI-GL startups, which have no cost basis to recognize against). SSP allocation across bundled obligations is deferred until product mix demands it. Contract asset/liability rollforward report ships with v1 (auditors ask for it first).

#### GAP-2 — Leases (ASC 842 / IFRS 16)

Nothing exists (verified: zero code hits). Build a lease subledger inside fixed assets: lease master (payments, term, IBR), PV computation, ROU asset + liability with effective-interest schedules, operating vs finance treatment (and IFRS 16 single-model when multi-book lands — GAP-5), monthly JEs from the close calendar, maturity-analysis disclosure export. Point-tool import (FinQuery JE upload) is the interim path via GAP-E1's JE import.

#### GAP-3 — Inventory valuation completeness (manufacturing credibility core)

Standard costing is enum-only (`standardCost` has no write path — Standard items cost at $0); no LCNRV write-downs; the `Revaluation` costLedgerType and `inventoryAdjustmentVarianceAccount`/overhead/lot-size/subcontracting variance accounts are dead schema; quantity adjustments post no GL; overhead absorption stops at estimates; no landed cost. Remediate in order: (1) wire standard cost input + actual-vs-standard variance posting (the accounts already exist), (2) inventory revaluation document (posts `Revaluation` cost-ledger rows + GL), (3) LCNRV write-down run with reversal support **per book** (US GAAP: no reversal; IAS 2: reversal required — first concrete consumer of GAP-5 multi-book), (4) GL posting for quantity adjustments, (5) overhead absorption to GL with `overheadVarianceAccount`, (6) landed cost (duty/freight/brokerage allocation onto receipts).

#### GAP-4 — Fixed assets completeness

Depreciation runs are entirely manual (no scheduled poster — a close-calendar risk now that period close is real); no impairment; no CIP; disposal lacks proceeds-based gain/loss (docs admit it); no component depreciation (IAS 16 requires it). Remediate: scheduled monthly depreciation proposal (Inngest) feeding an approvable Draft run and a close-readiness check; disposal-with-proceeds flow (link to sales invoice, gain/loss = proceeds − NBV); impairment posting (write-down account exists); CIP asset class + capitalization flow from job/PO costs; components as child assets (IFRS books later).

#### GAP-5 — Multi-GAAP parallel books

Single implicit book today. Per research (§Pattern 2), a book/ledger dimension is the single hardest retrofit in this list and is required the day the first foreign subsidiary files statutory accounts. Remediate in two steps: **now** (cheap): add `journal.bookId` defaulting to a seeded `PRIMARY` book, indexes and RPC filters included, so every future poster and report is book-aware from day one; **later**: adjustment-only books (NetSuite pattern — deltas on top of primary; first consumers: IFRS 16 leases, IAS 2 NRV reversals, statutory depreciation), book-specific depreciation per asset, and book columns in reporting UI.

#### GAP-6 — Accruals, deferrals, recurring journals

Only GR/IR exists. Build: prepaid-expense schedules (AP invoice line → amortization schedule → monthly journal; `prepaymentAccount` exists unused), recurring journal templates, and auto-reversing accrual JEs (flag on manual JE: post, auto-reverse day 1 next period — posting as *accounting* sources under the period matrix). All join the close-readiness checklist.

#### GAP-7 — Segment reporting (ASC 280) and dimension enforcement

Dimensions exist and system posters populate them, but the `required` flag is client-side only and there is no segment concept. Remediate: server-side enforcement of required dimensions at posting; a reserved **Segment** dimension derived from item/cost-center master data (SAP pattern: users never key segments); segment columns in the financial reports; ASU 2023-07 significant-expense breakdown by segment. (The budgeting spec's cost-center rollup is the structural precedent.)

### D. Multi-country statutory

#### GAP-D1 — Statutory tax filings beyond the tax spec

The multi-jurisdiction tax spec delivers determination, the tax ledger, liability reporting, returns with settlement, and UK/generic return layouts. Remaining for multi-country operation: **withholding tax** on cross-border AP (treaty rates, certificates, WHT returns), **EC Sales List and Intrastat** extracts (commodity codes/weights partially exist via the EORI work), **UK MTD digital-links-compliant API submission** (the tax spec produces the boxes; MTD requires unbroken digital submission), and e-filing adapters where authorities require electronic returns. US sales-tax content and filing stays with Avalara behind the tax spec's connector.

#### GAP-D2 — E-invoicing and legal invoice formats

Zero e-invoicing code exists; mandates are imminent for any EU footprint (France issue-mandate Sept 2026, Poland KSeF Feb/Apr 2026, Germany issue 2027–28, ViDA intra-EU 2030). Build the **adapter framework, not fifty adapters**: EN 16931 semantic invoice model generated from Carbon invoices (the tax spec's registrations, tax summary blocks, and VAT clauses are prerequisites — this builds directly on them); format renderers starting with Peppol BIS 3.0 / Factur-X / XRechnung; a clearance/submission state machine per document (Pending → Submitted → Accepted/Rejected → Corrected) with retry and rectification-document flows; inbound structured-invoice receipt into AP; country routing via a middleware partner (Avalara/Sovos/Pagero pattern) behind one internal interface; legal numbering series from SD-2. Clearance-model countries (Italy SDI, Mexico CFDI, Brazil NF-e, India IRP) come per customer demand via the same framework.

#### GAP-D3 — Statutory audit files, statutory COA, retention

Build on MW-1's JE export: **France FEC** (18-field prescribed layout — near-free once journal data is complete with preparer identity and gapless numbering), **SAF-T** country flavors (PT/PL/NO/RO) generated from GL/AR/AP/assets/inventory (the tax spec's `taxLedger` supplies the tax section), GoBD-compliant data access export. Statutory chart-of-accounts support via an **alternative account number mapping table** per country (SAP three-layer pattern — never fork the group COA); statutory reports render through the mapping. Record retention: accounting archives (audit-log + JE exports + invoice originals) in WORM-configured storage with per-country retention ≥10 years and legal hold.

### E. Ecosystem integration surface

#### GAP-E1 — The feeds every bolt-on needs

Public-company customers will bring BlackLine/FloQast, Workiva, Carta, provision tools, payroll, and expense systems (research §Ecosystem: even NetSuite doesn't build these). Carbon must expose: (1) **TB API** — balances by entity/book/period/dimension, stable account identifiers; (2) **JE-population export API** (MW-1's export, programmatic); (3) **controlled JE import API** — validated, approval-workflow-aware, period-status-aware, idempotent, audit-stamped (this is how Carta SBC entries, payroll summaries, lease JEs, and provision adjustments land); (4) webhooks for posting/close events (the period-closing lifecycle gives these real semantics). Most of this can ride the existing MCP/API-key infrastructure once approval + immutability gates exist.

### F. Vendor-level program (company, not code)

#### CO-1 — Assurance and operations

No SOC 1/SOC 2/ISO 27001 posture exists or is claimed; DR is explicitly "not disaster recovery" (docs); no staging tier. Public-company customers' auditors **rely on the vendor's SOC 1 Type II** — without it every customer takes a control gap (research §6). Program: SOC 2 Type II first (procurement gate, ~2 quarters of evidence), SOC 1 Type II covering posting-integrity control objectives (posting correctness, tax calc, depreciation calc, costing calc) + ITGCs (needs SD-3's environment work as prerequisites), ISO 27001 for EU procurement, PITR/DR with stated RPO/RTO, and eventually country invoicing-software certifications (Portugal AT, France PDP) gated on GAP-D2 market entry. Timeline reality: a customer IPO-ing in 2 years needs Carbon's SOC 1 period started ~now.

---

## Proposed Solution — Remediation Program

Phased so the remaining control keystones land first; each phase is independently shippable and PR-sized specs get cut from it per module. Phase ∅ is this branch: the six in-flight specs land per their own plans and are prerequisites for everything below.

| Phase | Contents (findings) | Theme |
|---|---|---|
| **∅ — This branch** | Period closing, multi-jurisdiction tax, financial reporting, budgeting, bank reconciliation + Plaid — now carrying three readiness fold-ins: posted-journal immutability + `journalLine.createdBy` (period-closing §Enforcement 4), Posted-only balance defaults (financial-reporting §11), universal source-currency population (bank-rec FX section) | Land the in-flight specs (already planned; not re-spec'd here) |
| **0 — Ledger integrity** | MW-1 remainder (payment/memo/settlement immutability triggers, accounting audit coverage always-on + synchronous, audit-table lockdown, JE export v1), MW-2 (JE/payment/invoice approval + no-self-approval + access/SoD reports), SD-1 remainder (DB balance constraint), SD-2 (gapless numbering, sequence lockdown, legal series substrate), GAP-5 step 1 (`journal.bookId`) | Make the ledger trustworthy. Schema seeds for everything later. |
| **1 — Close & FX completeness** | SD-4.2–.3 (unrealized FX revaluation as a close task, historical rates), SD-5 (rate-history feed, posted CTA, translated netChange), GAP-4.1 (scheduled depreciation + close check), GAP-6 (accruals/prepaids/recurring JEs) | A complete close calendar on top of the period-close lifecycle. |
| **2 — Subledger completeness** | GAP-1 (deferred revenue, deposits, POC v1), GAP-3 (standard cost, revaluation, LCNRV, adjustment GL, overhead, landed cost), GAP-4 (impairment, CIP, disposal proceeds), SD-6 (master-data controls incl. vendor bank details when payment execution lands) | Every balance-sheet line has a subledger that ties. |
| **3 — Multi-book & statutory** | GAP-5 (adjustment books), GAP-2 (leases), GAP-D3 (FEC/SAF-T/statutory COA/retention), GAP-D2 (e-invoicing framework), GAP-D1 (withholding, ECSL/Intrastat, MTD), GAP-7 (segments, dimension enforcement) | Multi-country statutory + dual-GAAP. |
| **4 — Scale-out** | SD-5.4–.5 (IC tolerance/netting/mirroring, NCI), GAP-E1 (TB/JE APIs, controlled JE import), SD-3 remainder (SSO/MFA enterprise, session revocation) | Consolidation maturity + ecosystem surface. |
| **∥ — Company program** | CO-1 (SOC 2 → SOC 1 → ISO 27001, staging, DR) | Runs parallel from Phase 0. |

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Posted-record immutability mechanism | Status-transition-only SECURITY DEFINER triggers on posted rows, all period states, binding service role | The period-close trigger (`20260702044133`) set the precedent and proved the pattern; RLS alone demonstrably failed (`WITH CHECK (true)` gaps) |
| 2 | Journal approval | Extend existing `approvalRule`/`approvalRequest` engine with `journalEntry`/`payment`/`purchaseInvoice` document types | Engine already has tiers/amounts/groups; per-document ad-hoc approvals are the anti-pattern; SAP parked→posted is the model; bank-rec's preparer→approver flow is the in-house precedent |
| 3 | Self-approval | Blocked server-side in `canApproveRequest`, all approval document types, default on | AS 2401 auditor test #1; one-line check; also fixes the existing PO self-approval hole |
| 4 | Year-end close | **Virtual** (computed RE/Net-Income split) — adopt the period-closing + financial-reporting decision; no posted closing entries, ever | Already decided on this branch; NetSuite/QBO model; self-healing on prior-year reopen; this audit originally proposed posted closing entries — withdrawn in favor of the branch's model |
| 5 | Multi-book placement | `journal.bookId` (header-level), seeded `PRIMARY` book, column lands Phase 0 | Header-level matches NetSuite books/SAP ledger-group posting; deferring the column is the expensive retrofit (research §Pattern 2) |
| 6 | Per-line currency | Adopt and universalize the bank-rec spec's `journalLine.sourceAmount`/`sourceCurrencyCode` (+ `exchangeRate`); base `amount` stays authoritative | One convention, already landing; FEC/SAF-T and remeasurement need it on every line, not best-effort |
| 7 | Draft journals in reports | Posted-only default + explicit include-drafts toggle on the balance RPCs | IPE integrity; financial-reporting spec already chose Posted+Reversed for GL detail; period-close readiness keeps blocking close on drafts |
| 8 | Audit logging for accounting entities | Always-on, synchronous in-transaction, append-only tables, ≥7-year retention | Async-opt-in-30-day serves operational forensics, not ICFR; the branch specs route their audit trail here, so hardening it protects them too |
| 9 | Gapless numbering | DB-serialized per-company counter assigned inside the posting transaction; `sequence` rows immutable-after-first-use | FEC validates sequential completeness; app-level pre-allocation demonstrably gaps |
| 10 | CTA | Posted to `currencyTranslationAccount` resolved by id at group close | Display-plug doesn't roll forward; hardcoded "3200" violates the repo's control-account lesson (also flagged by the financial-reporting spec as a follow-up) |
| 11 | Rev-rec v1 scope | Deferred revenue + deposits + cost-based POC; SSP allocation deferred | Manufacturing customer need; POC leverages job costing Carbon uniquely has; NetSuite ARM full model is a later tier |
| 12 | Recs/SEC/equity/provision/payroll | Never build; expose GAP-E1 feeds | Even NetSuite doesn't build these (research §Ecosystem); bank-rec covers reconciliation of cash natively — the rest of the rec universe stays ecosystem |
| 13 | Multi-tenancy heuristic | All new tables: `companyId` + composite PK + `id('prefix')` + audit columns; books group-scoped like `account`/`currency` (scoping question below) | Matches company-group master-data pattern (`20260228023426`) |
| 14 | Service shape / RLS / permissions / forms / module layout | Per repo conventions; new work in `modules/accounting` (+ `modules/invoicing` where document-side); `requirePermissions` with `accounting_*` scopes; follows the branch specs' precedent of reusing `accounting_update`/`accounting_delete` tiers rather than new permission actions | Heuristics 2–6; the period-closing spec already established reopen = `delete: accounting` rather than a new action — follow it |
| 15 | Backward compatibility | Additive schema only; immutability + Posted-only reports are behavior changes shipped behind a company-level activation event (see Open Questions on the accounting switch) | FROZEN surfaces unaffected; posting-function changes ship as coordinated PRs per the FX-spec precedent |

## Data Model Changes (representative sketches, Phase 0)

The period-close lifecycle, tax subledger, budget, and bank tables are already specified in their own specs on this branch — not repeated here. Phase 0 adds:

```sql
-- Journal control columns (MW-1/MW-2, GAP-5, SD-4)
ALTER TABLE "journal"
  ADD COLUMN IF NOT EXISTS "bookId" TEXT NOT NULL DEFAULT 'PRIMARY',  -- FK "accountingBook", seeded per group
  ADD COLUMN IF NOT EXISTS "preparedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "approvalRequestId" TEXT;
ALTER TABLE "journalLine"
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT REFERENCES "user"("id");
-- sourceAmount / sourceCurrencyCode arrive via the bank-reconciliation spec's
-- migration; Phase 0 makes every posting path populate them (+ exchangeRate).

-- Immutability backstop (period-close trigger pattern: SECURITY DEFINER,
-- binds service role). Posted journals: only status-transition updates
-- (Posted -> Reversed with reversedById) allowed, in ALL period states;
-- journalLine rows frozen once the parent is Posted; payment/memo/
-- invoiceSettlement mirror with Posted -> Voided.

CREATE TABLE IF NOT EXISTS "accountingBook" (
    "id" TEXT NOT NULL DEFAULT id('bk'),
    "companyGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Primary',              -- Primary | Adjustment
    "accountingPrinciple" TEXT,                          -- US-GAAP | IFRS | Local | Tax
    "baseBookId" TEXT,                                   -- for Adjustment books
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "accountingBook_pkey" PRIMARY KEY ("id", "companyGroupId")
);

-- Deferred constraint trigger: per-journal Σ(signed line amounts) = 0 at COMMIT
-- (0.01 tolerance) — covers every poster including edge functions.

-- Audit hardening: audit.config.ts gains journal/journalLine/account/
-- accountingPeriod/payment/memo/sequence/userPermission/apiKey/approval*/
-- accountDefault/taxCode/taxCodeComponent/bankAccount; accounting entities
-- write synchronously in-transaction; auditLog_* tables become append-only
-- (REVOKE UPDATE/DELETE + restrictive policies); per-class retention config.
```

RLS per conventions; all new tables audit-logged from day one. Full DDL per phase lands in that phase's implementation spec.

## API / Service Changes

Phase 0 (representative): posting edge functions populate `journalLine.createdBy` + source-currency columns and `journal.preparedBy`; `postJournalEntry` gains approval-state checks (`Draft → Pending Approval → Posted` when a rule matches); `canApproveRequest` self-approval block; JE-population export route + service (`/x/accounting/exports/journal-entries`, streaming, no row caps); user-access-report and SoD-conflict-report services under settings; balance RPCs gain a `p_include_drafts` parameter defaulting false. Phases 1–4 per their own specs when cut.

## UI Changes

Phase 0: journal-entry approval states in `JournalEntryForm` + approval inbox reuse; "include drafts" toggle on the report filter bars; JE export page; access-review + SoD-conflict reports under settings/users; audit-log settings lose the disable toggle for accounting entities (with explanatory copy). Later phases per their specs.

## Acceptance Criteria

Phase 0 (the ICFR keystones — each maps to an auditor test; the period-close criteria live in the period-closing spec):

- [ ] A posted journal's header and lines cannot be modified via PostgREST with any role, including a direct service-role UPDATE, in an **open** period — only `Posted → Reversed` transitions succeed; same for posted payments/memos (`Posted → Voided`).
- [ ] With an approval rule active, a manual journal cannot reach `Posted` without a second user's approval; the preparer attempting to approve their own entry is rejected server-side; `preparedBy`/`approvedBy` appear on the journal and in the JE export; the same self-approval block now also applies to purchase orders.
- [ ] The JE export for a fiscal year contains every journal line (manual + all system source types), reconciles opening TB + export = closing TB per account, and includes preparer, approver, createdAt, postedAt, source type, book, source currency/amount, and reversal linkage on every row.
- [ ] An unbalanced journal insert (Σ signed amounts ≠ 0) is rejected at COMMIT regardless of which code path wrote it.
- [ ] Trial balance/BS/IS show Posted-only by default; the drafts toggle reproduces today's numbers; period-close readiness still flags open drafts.
- [ ] Journal numbering shows no gaps across a simulated posting-failure test; editing a used sequence is rejected and logged.
- [ ] Changes to `journal`, `account`, `accountingPeriod`, `payment`, `sequence`, `taxCode`, and `userPermission` appear in the audit log with actor + before/after, synchronously with the transaction, with audit logging on regardless of the company toggle; UPDATE/DELETE on the audit tables themselves is impossible for every role.
- [ ] The user access report lists every user's effective permissions per company as of a chosen date; the SoD report flags a seeded test user holding JE-create + JE-approve.

Phase 1 spot checks: unrealized FX revaluation posts and auto-reverses from the close checklist; a consolidated report of a two-currency group with no manual rate entry uses real rates (and warns when history is missing) with CTA posted to the configured account; depreciation proposal appears on schedule and blocks close-readiness until posted or skipped. Later phases define theirs in their specs.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Immutability triggers break existing flows that mutate posted journals (void/reverse paths, Xero sync writebacks) | High | Inventory every writer first (posters are enumerable); allow status-transition writes; extend the post-payment golden-master tests; ship behind the activation event |
| Gapless posting-time numbering serializes posting throughput per company | Med | Per-company (not global) advisory-lock counter; measure; documents keep draft IDs until post |
| Synchronous audit writes slow posting hot paths | Med | Same-transaction insert is one row per change; benchmark; transactional outbox as fallback — never fire-and-forget for accounting entities |
| Posted-only reports change numbers customers currently see | Med | Release note + drafts toggle; tie-outs unaffected (they already reconcile to control accounts); close-readiness unaffected |
| Interplay with the six in-flight specs (this program's Phase 0 touches the same posting functions their plans touch) | Med | Sequence: land Phase ∅ first; Phase 0 rebases on their merged state; the immutability trigger must permit the tax spec's VOID re-posting and bank-rec's tolerance JEs (status-transition + new-document patterns only) |
| Behavior changes vs the "accounting is a switch" positioning confuse existing users | Med | All Phase-0 controls activate at a company-level cutover event (see Open Questions) |
| Scope: this program is quarters of work competing with product roadmap | High | Phases are independently valuable; Phase 0 alone is a marketable "SOX-ready controls" release; later phases gate on customer geography/stage |

## Open Questions

> 🛑 HARD STOP: Do not proceed with implementation until these are answered.

- [x] **Does "accounting is a switch" survive?** — **Answer (Brad, 2026-07-03): No.** `accountingEnabled` is a temporary **internal feature flag** while the accounting suite is completed — not a product concept. At GA, accounting is always-on: new companies get it from creation; existing companies go through a one-way, dated **cutover event** (opening-balance journal, config lock, controls on from day one), after which the flag is removed from the codebase. Cutover runbook and flag-retirement criteria: `.ai/plans/2026-07-03-public-company-readiness-roadmap.md` §Cutover.
- [x] **Sanctioned repair path under immutability** — **Answer (Brad, 2026-07-03): reversal-only, plus a controlled repair channel.** No in-place edits ever, for anyone including the service role. Data fixes post correcting entries through an immutable, audit-logged `'Repair'` journal source type (permissioned, reason required). The invoice/payment audit's deferred historical-repair work uses this channel.
- [x] **Approval scope at launch** — **Answer (Brad, 2026-07-03): journals + payments + purchase invoices, ASAP**, reusing the existing PO approval engine (`approvalRule`/`approvalRequest`). Pulled forward in the roadmap: this workstream has no dependency on Phase ∅ and starts immediately.
- [x] **Gapless numbering domain** — **Answer (2026-07-03):** the `JE-yyyy-mm` format is not a compliance violation and **existing journals are never renumbered** (retroactive renumbering is itself an audit red flag). The defects are gaps (number taken before the transaction commits) and a rewindable `sequence` table. Fix forward-only in Phase 0 Spec C: number assigned inside the posting transaction, used sequences immutable + audit-logged, historical-gap cutover date documented. Legal invoice series (statutory gapless numbering of customer-facing invoices in EU/LatAm — not journals) get their table in Phase 0, wired to documents with e-invoicing in Phase 3.
- [x] **Draft journals in balance RPCs** — **Answer (2026-07-03):** Posted-only by default, with an explicit "Include drafts" toggle preserving the preview workflow. Folded into the financial-reporting spec §11 (`p_include_drafts DEFAULT FALSE`) since that spec redefines the RPCs anyway; drill-down drawer follows its parent so the tie-out contract holds in both modes.
- [x] **Rev-rec v1 cut** — **Answer (Brad, 2026-07-03): accepted with a TODO.** Deferred revenue + customer deposits + cost-based POC; SSP/multi-element allocation deferred. **TODO before cutting the Phase-2 spec: validate the cut against real customer contracts** (do any current/pipeline customers bundle obligations that need SSP allocation?).
- [x] **Unrealized FX method** — **Answer (Brad, 2026-07-03): SAP-style auto-reverse** — revaluation posts at period end and auto-reverses on day 1 of the next period; self-healing by construction.
- [x] **E-invoicing partner** — **Answer (Brad, 2026-07-03): Avalara, as a first-class integration** — same posture as the tax spec's AvaTax connector (Avalara E-Invoicing/ELR APIs behind Carbon's adapter interface and clearance state machine), not a thin passthrough.
- [x] **SoD preventive vs detective for v1** — **Answer (Brad, 2026-07-03): detective.** Conflict-matrix reporting + documented mitigating controls; preventive grant-blocking deferred to customer demand.
- [x] **SOC 1 timing and scope** — **Answer (Brad, 2026-07-03): recommendation accepted.** SOC 2 Type II evidence period starts now; SOC 1 Type II scoped to posting integrity + depreciation + costing after Phase 0 lands; tax calculation joins the scope once the tax spec stabilizes in production.
- [x] **Book scoping** — **Answer (Brad, 2026-07-03): recommendation accepted.** Group-scoped `accountingBook` definitions with per-company enablement — matches the shared chart-of-accounts pattern; a statutory book (e.g. HGB) is defined once at group level and enabled only for the entities it applies to. Unblocks the Phase-0 `bookId` seed.

## Changelog

- 2026-07-03: Created from the public-company readiness assessment (9 research workstreams: accounting core, multi-entity/FX, controls/ITGC, domain subledgers, repo baseline, NetSuite, SAP, regulatory inventory, ecosystem). Research: `.ai/research/public-company-compliance.md`.
- 2026-07-04: MW-2 remediation spec'd: `.ai/specs/2026-07-04-document-approvals.md` (scope expanded to include memos as a fourth gated document type; reversals/voids not gated in v1; opt-in rules; escalation reminder; access + SoD reports). The dead sales-order `'Needs Approval'` enum value stays untouched (Postgres enums can't drop values; SO approvals out of scope).
- 2026-07-03: All remaining open questions resolved by Brad (repair channel; approvals for JEs+payments+purchase invoices ASAP on the existing engine; forward-only gapless numbering, no renumbering of history; rev-rec cut accepted with a contract-validation TODO; auto-reverse FX; Avalara first-class for e-invoicing; detective SoD; SOC timing accepted; group-scoped books with per-company enablement). Gate cleared — Phase-0 specs may be cut; approvals workstream pulled forward to start immediately. Status → in-progress.
- 2026-07-03: Open question 1 resolved (accounting switch = temporary internal FF; always-on at GA with a cutover event). Program plan created at `.ai/plans/2026-07-03-public-company-readiness-roadmap.md`. Three right-the-first-time fold-ins pushed into the unbuilt specs: posted-record immutability + `journalLine.createdBy` → period-closing spec (shrinks MW-1 remediation to audit-coverage + export + payment/memo immutability); Posted-only balance defaults → financial-reporting spec (resolves SD-1's draft half); universal `sourceAmount`/`sourceCurrencyCode` population → bank-reconciliation spec (resolves SD-4.1).
- 2026-07-03: Rebased onto the `period-closing-spec` branch baseline. The branch's six in-flight specs (period closing, multi-jurisdiction tax, financial reporting, budgeting, bank reconciliation, Plaid feeds) are now assumed implemented: former findings MW-1 (period close), MW-4 (tax misstatement), most of MW-5 (year-end/cash flow/comparatives — via the branch's virtual year-end model, which this audit now adopts), GAP-8 (budgets/flux), and GAP-9 (bank) are removed or re-scoped to their remainders. Two material-weakness-level findings remain (record immutability/audit trail; JE approval/SoD); phases renumbered around a Phase ∅ = land this branch.
