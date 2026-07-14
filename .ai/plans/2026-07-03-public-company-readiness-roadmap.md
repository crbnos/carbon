# Public-Company Readiness — Program Roadmap

> Spec: `.ai/specs/2026-07-03-public-company-readiness.md` (the audit; findings referenced as MW-*/SD-*/GAP-*/CO-*)
> Research: `.ai/research/public-company-compliance.md`
> Status: active program tracker — check items off as workstreams land
> Owner: brad@carbonos.dev

## Goal

Carbon becomes an accounting system a CFO adopts at seed and keeps through IPO and beyond as a US-listed multi-national. "Full readiness" is defined by the exit criteria at the bottom of this plan — not by feature count.

## Governing decisions (locked)

1. **Accounting is NOT a switch.** `companySettings.accountingEnabled` is a temporary internal feature flag while the suite is completed. It is never exposed as a customer setting. At GA, accounting is always-on: new companies from creation, existing companies through the one-way cutover event (§Cutover). The flag is then removed from the codebase. (Resolved 2026-07-03.)
2. **Virtual year-end.** No posted closing entries, ever — the computed Retained Earnings / Net Income split (period-closing + financial-reporting specs) is the permanent model.
3. **Right the first time.** Because the six Phase-∅ specs are unbuilt, three readiness items were folded into them on 2026-07-03 rather than scheduled as retrofits:
   - Posted-record immutability + `journalLine.createdBy` → period-closing spec §Enforcement item 4 (same trigger wave as the close backstop).
   - Posted-only balance defaults (`p_include_drafts DEFAULT FALSE` + report toggle) → financial-reporting spec §11 (the RPCs are being redefined anyway).
   - Universal `journalLine.sourceAmount`/`sourceCurrencyCode` population (every posting path, base documents included) → bank-reconciliation spec FX section (serves FEC/SAF-T + ASC 830, not just bank matching).
   Their plan files carry ⚠️ delta banners; update task lists before executing.
4. **Build vs integrate.** Carbon builds the GL baseline + statutory surfaces + integration feeds; it never builds reconciliation certification, SEC/XBRL, equity/718, tax provision, payroll, or US sales-tax content (research §Ecosystem — even NetSuite doesn't).
5. **All spec open questions resolved 2026-07-03** (recorded inline in the spec): reversal-only + audited `'Repair'` journal channel; **approvals for manual JEs, payments, and purchase invoices ASAP** on the existing PO approval engine (workstream pulled forward — starts now); forward-only gapless numbering, existing journals never renumbered; rev-rec cut accepted with a contract-validation TODO; auto-reverse unrealized FX; **Avalara first-class** for e-invoicing; detective SoD v1; SOC 2 evidence starts now → SOC 1 after Phase 0; group-scoped books with per-company enablement.

## Phase ∅ — Land this branch (prerequisite for everything)

Suggested order (dependencies noted). Each executes per its own plan.

- [ ] **Period closing** (`.ai/plans/2026-07-02-period-closing.md`) — first: budgeting depends on `fiscalYear`/`periodNumber`; financial reporting's period picker reads them; every later close task assumes the lifecycle. Includes the immutability fold-in (delta banner).
- [ ] **Financial reporting** (`.ai/plans/2026-07-02-financial-reporting.md`) — includes the Posted-only fold-in (delta banner).
- [ ] **Bank reconciliation Phase 1** (`.ai/plans/2026-07-02-bank-reconciliation-phase-1.md`) — includes the universal source-currency fold-in (delta banner); lands the `journalLine` FX columns everything in Phase 1 below reads.
- [ ] **Multi-jurisdiction tax Phase 1** (spec ready; cut plan via `/plan`) — determination, corrected posting, `taxLedger`, liability report.
- [ ] **Budgeting Phase 1** (`.ai/plans/2026-07-02-budgeting.md`) — after period closing.
- [ ] **Plaid bank feeds** (bank Phase 2; spec ready).
- [ ] **Tax Phase 2–3** (returns/settlement/use tax; Avalara + Xero mapping).
- [ ] **Budgeting Phase 2–3** (commitments + control; IS integration, consolidated BvA).
- [ ] **Bank Phase 3–4** (full format matrix, rules engine, transfers; intelligence layer).

## Phase 0 — Ledger integrity (the two remaining MWs + numbering)

Cut as three specs via `/spec-writing`, then `/plan` + execute each.
**Spec B (approvals) is pulled forward — it depends only on the existing
approval engine, not on Phase ∅, and Brad wants it ASAP. Start it now, in
parallel with the Phase-∅ workstreams.**

- [ ] **Spec A: Record integrity & audit hardening** (MW-1 remainder, SD-1 remainder)
  - [ ] Immutability triggers for posted `payment`/`memo`/`invoiceSettlement` (`Posted → Voided` only), completing what the period-closing fold-in does for journals.
  - [ ] Deferred constraint trigger: Σ(signed `journalLine.amount`) = 0 per journal at COMMIT (±0.01) — every writer, including edge functions.
  - [ ] Audit coverage extension (`audit.config.ts` — ask-first file, this spec is the ask): `journal`, `journalLine`, `account`, `accountingPeriod`, `payment`, `memo`, `sequence`, `userPermission`, `apiKey`, `approvalRequest`/`approvalRule`, `accountDefault`, `taxCode`/`taxCodeComponent`, `bankAccount`, `paymentTerm`, `customerTax`/`supplierTax`.
  - [ ] Accounting entities: audit **always-on** (company toggle governs operational entities only) and **synchronous in-transaction** (or transactional outbox) — never PGMQ fire-and-forget.
  - [ ] Audit tables: append-only (REVOKE UPDATE/DELETE + restrictive policies), per-class retention (≥7 years accounting, 30-day default operational), archive integrity.
  - [ ] **JE population export** (route + streaming service, no row caps): journal id/line, account, signed amount + debit/credit presentation, posting date, createdAt/postedAt, `createdBy`/`preparedBy`/`approvedBy`, source type, document ref, reversal linkage, source currency/amount, book. This is the SOX AS 2401 / FEC / GoBD / SAF-T substrate.
  - [ ] **Repair channel** (resolved): a `'Repair'` journal source type — the only sanctioned data-fix path once immutability lands. Permissioned, reason required, correcting-entries only (never in-place edits), itself immutable and audit-logged; the invoice/payment audit's deferred historical-repair work flows through it.
- [ ] **Spec B: Document approvals & SoD reporting** (MW-2) — **✅ SPEC WRITTEN 2026-07-04**: `.ai/specs/2026-07-04-document-approvals.md` (all four remaining questions resolved before writing) — next: `/plan`, then execute
  - Scope as spec'd: `approvalDocumentType` += `journalEntry`, `payment`, `purchaseInvoice`, **`memo`** (added by resolution); `'Pending Approval'` status on all four documents; gates placed to survive bypass (JE gate inside `postJournalEntry` covering the MCP path; payment/memo edge functions accept the parked status only with an Approved request in-transaction; `post-purchase-invoice` finally gains a status guard); **no-self-approval** server-side for all types incl. existing POs (`enforceNoSelfApproval` default on, disable = audited standing exception); reversals/voids NOT gated in v1 (audit-logged + approver-notified); opt-in rules, no seeding (SoD report flags companies without a JE rule); escalation reminder job makes `escalationDays` real; `journal.preparedBy/approvedBy/approvalRequestId`; user access report + detective SoD conflict report with standing-exception tracking.
- [ ] **Spec C: Gapless numbering & legal series** (SD-2) — resolved: forward-only fix, **existing journals are never renumbered** (historical gaps are documented with a cutover date, not rewritten)
  - [ ] `journalEntryId` keeps the `JE-yyyy-mm-` format but is assigned **inside the posting transaction** from a DB-serialized per-company counter — gapless from the cutover date forward.
  - [ ] `sequence` rows for accounting documents immutable-after-first-use + audit-logged (kills the rewind→duplicate-number hole).
  - [ ] `legalSeries` table (entity × country × document type) for customer-facing **sales invoices/credit notes** (the EU/LatAm statutory gapless-series requirement — not journals) — substrate for e-invoicing (Phase 3); backdating flag (postingDate ≪ createdAt) in the JE export.
- [ ] **Schema seed:** `journal.bookId` (+ `accountingBook` table, seeded `PRIMARY` per group) — lands with Spec A's migration so every later poster/report is book-aware (GAP-5 step 1). Scoping resolved: **group-scoped definitions with per-company enablement** (an `accountingBookCompany` enablement table), mirroring the shared chart-of-accounts pattern.
- [ ] **Cutover tooling** (§Cutover below) — spec the activation event + opening-balance wizard; required for flag retirement, so it belongs to Phase 0 even though it ships last in it.

## Phase 1 — Close & FX completeness

- [ ] **Unrealized FX revaluation** (SD-4): close task revaluing open FX invoices, unapplied payments/memos, FX bank balances at period-end rate; **SAP-style auto-reversing** entries (post at period end, reverse day 1 next period — self-healing; resolved 2026-07-03) to new `unrealizedExchangeGain/LossAccount` defaults; posts as *accounting* source; joins `getPeriodCloseReadiness`.
- [ ] **Exchange-rate history feed** (SD-5): daily job appends `exchangeRateHistory` closing rates + derives period averages; consolidated reports warn on missing coverage instead of silently falling back to rate 1.
- [ ] **Posted CTA** (SD-5): consolidation posts CTA to `accountDefault.currencyTranslationAccount` resolved by id (kill the hardcoded "3200"); CTA rolls forward; translated income statement learns `netChange`.
- [ ] **Scheduled depreciation** (GAP-4.1): monthly Inngest proposal → Draft depreciation run → approval → post; close-readiness check "depreciation posted for period".
- [ ] **Accrual engines** (GAP-6): prepaid amortization schedules (AP line → schedule → monthly journal), recurring journal templates, auto-reversing accrual flag on manual JEs — all close-checklist tasks.

## Phase 2 — Subledger completeness

- [ ] **Revenue recognition v1** (GAP-1): deferred revenue schedules + recognition journal; customer deposits/prepayments as liabilities; cost-based percent-of-completion for long-lead jobs (uses existing job costing); contract asset/liability rollforward report. SSP allocation explicitly deferred. **TODO before cutting this spec (resolved with condition): validate the cut against real customer contracts — check current/pipeline customers for bundled obligations that would force SSP allocation earlier.**
- [ ] **Inventory valuation** (GAP-3): standard-cost input + actual-vs-standard variance posting → inventory revaluation document (`Revaluation` cost-ledger type) → LCNRV write-down run (reversal per book: US no, IAS 2 yes — first multi-book consumer) → GL posting for quantity adjustments → overhead absorption to GL → landed cost.
- [ ] **Fixed assets completeness** (GAP-4): disposal with proceeds (gain/loss = proceeds − NBV), impairment posting, CIP asset class + capitalization from job/PO costs, component assets.
- [ ] **Master-data change controls** (SD-6): supplier bank details table + approval-gated changes (prereq for any payment execution), change alerts on `accountDefault`/tax config.

## Phase 3 — Multi-book & statutory

- [ ] **Adjustment books** (GAP-5): NetSuite-style delta books on `bookId`; book-specific depreciation per asset; book columns in reports. First consumers: IAS 2 reversals, statutory depreciation, IFRS 16.
- [ ] **Leases** (GAP-2): lease master, PV/IBR, ROU + liability effective-interest schedules, operating vs finance (+ IFRS 16 single model per book), monthly JEs, maturity-analysis export.
- [ ] **Statutory audit files** (GAP-D3): FEC 18-field export (thin layer over the Phase-0 JE export), SAF-T country flavors (taxLedger supplies the tax section), GoBD data-access export; statutory COA alternative-account-number mapping; WORM retention ≥10y + legal hold.
- [ ] **E-invoicing framework** (GAP-D2): EN 16931 semantic model from Carbon invoices (tax spec's registrations/summary blocks are prereqs); Peppol BIS 3.0 / Factur-X / XRechnung renderers; clearance state machine (Pending → Submitted → Accepted/Rejected → Corrected); inbound structured invoices into AP. **Partner resolved: Avalara as a first-class integration** (Avalara E-Invoicing APIs behind Carbon's adapter interface, same posture as the tax spec's AvaTax connector — the two share `companyIntegration` credentials). France Sept 2026 is the first hard deadline.
- [ ] **Filing extensions** (GAP-D1): AP withholding tax (treaty rates, certificates), EC Sales List + Intrastat extracts, UK MTD digital-links submission.
- [ ] **Segments** (GAP-7): server-side enforcement of required dimensions at posting; reserved Segment dimension derived from master data; segment columns on statements; ASU 2023-07 expense detail.

## Phase 4 — Scale-out

- [ ] **Intercompany maturity** (SD-5): matching tolerance + FX-difference posting; IC document mirroring (PO↔SO); netting workbench; ownership % + NCI only when a sub-100% subsidiary is real.
- [ ] **Integration surface** (GAP-E1): TB API (entity/book/period/dimension), JE export API, **controlled JE import API** (validated, approval- and period-aware, idempotent, audit-stamped — how Carta/payroll/lease/provision entries land), posting/close webhooks. Rides MCP/API-key infra once Phase 0 gates exist.
- [ ] **Enterprise ITGC** (SD-3 remainder): SAML/OIDC SSO, MFA enforcement policy, session revocation on deactivate + admin session listing, API-key audit events. Preventive SoD enforcement if customer demand.

## ∥ Company program (starts now, runs parallel — CO-1)

- [ ] Staging environment in the deploy pipeline; CODEOWNERS on `packages/database` + posting functions; make `pnpm audit` blocking at high/critical.
- [ ] PITR/DR with documented RPO/RTO (today's docs say "a backup is not disaster recovery").
- [ ] SOC 2 Type II: pick auditor, start evidence period (~2 quarters) — procurement gate for any mid-market+ customer.
- [ ] SOC 1 Type II: scope control objectives (posting integrity, tax calc, depreciation calc, costing calc) + ITGCs; requires the staging/change-management items above. A customer IPO-ing in 2 years needs this period started ~now.
- [ ] ISO 27001 (EU procurement); country invoicing-software certifications (Portugal AT, France PDP) gated on Phase-3 market entry.

## Cutover — accounting goes always-on

### Now (pre-GA)

- `accountingEnabled` stays as-is mechanically but is treated as an **internal-only** flag: no customer-facing setting, no docs describing accounting as optional (update `docs/content/docs/reference/accounting.mdx` language at GA). Internal/design-partner companies flip it manually as today.

### GA gate (flag retirement criteria)

The flag is removed when ALL of:
1. Phase ∅ fully landed (close lifecycle, tax posting, statements, bank rec).
2. Phase 0 fully landed (immutability, approval, audit hardening, numbering, JE export).
3. Cutover tooling (below) shipped and exercised on at least two internal companies.

### New companies (at GA)

- `seed-company` creates every company with accounting active: COA, accountDefaults, fiscal settings, `PRIMARY` book, current-year periods generated, all Phase-0 controls on. No opening balances needed — the ledger starts at zero on day one.

### Existing companies — cutover runbook (one-way, per company)

1. **Prepare** (any time before): choose cutover date = first day of a fiscal period; complete configuration — accountDefaults (a completeness check must pass: every referenced default account set), tax codes assigned to parties, bank accounts created and GL-linked, fiscal year settings confirmed (they lock at activation).
2. **Opening balances**: a wizard builds a proposed opening trial balance as a Draft journal (new `sourceType: 'Opening Balance'`, dated cutover date − 1 day):
   - Inventory: valuation from `costLedger`/`itemCost` as of cutover.
   - AR/AP: open invoice balances (post-tax-spec: net + tax split).
   - Fixed assets: cost + accumulated depreciation from the register.
   - Cash/equity/loans/everything else: manual entry against the wizard's remaining-to-balance line.
   The journal must balance and must tie: AR/AP tie-out and inventory-valuation-vs-GL checks run against the draft before activation is allowed. If migrating from another GL, the opening TB is keyed from that system's closing TB instead, with the same tie-out checks.
3. **Activate** (permissioned `accounting_update`, explicit confirmation, one-way): posts the opening journal; stamps `company.accountingActivatedAt/By`; locks `baseCurrencyCode` + fiscal settings; generates the fiscal year's periods; **closes all periods before the cutover date** (the period-close trigger then guarantees pre-history stays empty — no retroactive GL from old operational documents, the opening journal is the only bridge); enables all posting paths.
4. **First close**: run the first month-end per the close-readiness checklist; if parallel-running an old GL, compare trial balances at month 1 and document differences (this comparison is the audit evidence for the migration).
5. **Retire the flag**: when every active company has `accountingActivatedAt`, remove `accountingEnabled` reads from the posting functions (one PR — the guards are enumerable), then drop the column in a follow-up migration.

Audit posture: the activation event, opening journal, config locks, and pre-cutover period closes are all audit-logged (Phase 0 makes that trail synchronous and immutable). For a future public company, the cutover date is the start of auditable history in Carbon; anything earlier lives in the prior system's records under the retention policy.

## Definition of full readiness (exit criteria)

**Controls:** period close enforced at DB for all writers; posted records immutable everywhere (journals, lines, payments, memos, settlements); JE approval with system-enforced no-self-approval; always-on synchronous audit trail, append-only, ≥7-year retention, covering all accounting + permission tables; gapless journal + legal document numbering; user-access and SoD-conflict reports; JE population export reconciling opening→closing TB.
**Statements:** BS/IS/TB/SCF/GL-detail Posted-only with comparatives, consolidated across mixed currencies with real (warned) rates and posted, rolled-forward CTA; budget-vs-actual; PDF/CSV everywhere.
**GAAP:** deferred revenue + deposits + POC with rollforwards; lease subledger; LCNRV + standard costing + revaluation + landed cost; impairment/CIP/component assets; accrual/prepaid/recurring engines; ≥1 adjustment book proving multi-GAAP; segment-tagged statements.
**Statutory:** tax returns with settlement per registration; e-invoicing live in target markets with clearance tracking; FEC/SAF-T/GoBD exports; statutory COA mapping; WORM retention + legal hold.
**Ecosystem:** documented TB/JE-export/JE-import APIs + webhooks; at least one live integration each for close-management, equity, and payroll JE import.
**Vendor:** SOC 1 Type II issued (SOC 2 + ISO 27001 alongside); staging + PITR/DR with stated RPO/RTO.

## Remaining open questions

**None.** All nine resolved by Brad on 2026-07-03 — recorded inline in the spec's Open Questions section and in Governing decision 5 above. One conditional carry-forward: the rev-rec contract-validation TODO (Phase 2) must be done before that spec is cut.

## Changelog

- 2026-07-03: Created. Governing decisions locked (switch → internal FF + cutover; virtual year-end; three fold-ins applied to unbuilt specs with delta banners on their plans).
- 2026-07-04: Spec B written (`.ai/specs/2026-07-04-document-approvals.md`) after resolving its four open questions with Brad first (per the reordered spec-writing flow): memos added as a fourth gated document type; reversals/voids not gated in v1; opt-in rules with no seeding; escalation reminder job in v1.
- 2026-07-03: All nine open questions resolved (Governing decision 5). Approvals workstream (Phase 0 Spec B — JEs + payments + purchase invoices on the existing PO engine) pulled forward to start immediately, in parallel with Phase ∅. Numbering fix confirmed forward-only (no renumbering of history); book scoping = group definitions + per-company enablement; FX = auto-reverse; e-invoicing = Avalara first-class; SoD = detective v1.
