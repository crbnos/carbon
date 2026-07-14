# Public-Company Compliance Research: Best Practices Survey

> Feeds: `.ai/specs/2026-07-03-public-company-readiness.md`
> Date: 2026-07-03
> Question: what must an accounting system provide for a CFO to adopt it early and keep it through IPO and beyond, as a US-listed (or dual-listed) company operating in multiple countries?

## Summary

We surveyed the two reference systems (SAP S/4HANA for enterprise patterns, NetSuite as the system most mid-market companies actually IPO on), the regulatory requirements themselves (SOX 404/ICFR, US GAAP standards needing system support, IFRS deltas, SEC reporting chain, multi-country statutory/e-invoicing mandates, vendor assurance), and the bolt-on ecosystem that defines what an ERP is NOT expected to build. Consensus: the load-bearing architecture decisions are (1) an immutable, complete, exportable journal population with preparer/approver metadata — one investment that satisfies SOX AS 2401, France FEC, Germany GoBD, and SAF-T simultaneously; (2) a book/ledger dimension on every journal line for multi-GAAP parallel accounting — the single hardest thing to retrofit; (3) hard period close with permissioned locking; (4) JE approval with system-enforced no-self-approval; (5) functional-currency remeasurement vs. translation as two distinct mechanisms with CTA memory; and (6) a trading-partner stamp on intercompany lines to make eliminations automatable. Everything downstream (recs certification, SEC/XBRL, equity comp, tax provision, payroll) is deliberately left to the ecosystem — even NetSuite does not build those — provided the ERP exposes clean TB/JE extracts and a controlled JE-import surface.

## Competitors Surveyed

- **Oracle NetSuite (OneWorld, Multi-Book, ARM, SuiteTax)** — the system "63% of technology IPOs since 2011" ran; defines the practical mid-market bar for "hold through IPO."
- **SAP S/4HANA (Universal Journal, Group Reporting, DRC, GRC)** — the enterprise reference for parallel ledgers, currency architecture, consolidation, and country localization.
- **Regulatory sources** — PCAOB AS 2201/2401 practice, ASC 606/842/718/740/830/280/330/805, IFRS 15/16, IAS 2/16/21, SEC iXBRL rules, EU ViDA + country e-invoicing/SAF-T/FEC/GoBD/MTD regimes, SOC 1/SOC 2/ISO 27001 expectations of a SaaS accounting vendor.
- **Ecosystem** — BlackLine/FloQast, Workiva, Carta/Shareworks, OneSource/Corptax, Avalara/Vertex, Fastpath/Strongpoint (see §Ecosystem below).

## Key Consensus Patterns

### 1. One immutable journal population is the compliance keystone

- **SAP**: posted documents are immutable; corrections are reversal documents only; master-data changes tracked as change documents (CDHDR/CDPOS, old value → new value); gapless document numbering per company code + fiscal year is a legal requirement in many jurisdictions.
- **NetSuite**: System Notes capture field-level before/after with user, role, timestamp, and context (UI vs. script vs. web services); GL Audit Numbering assigns a gapless sequence to posted entries as a close task; the JE population is exported via saved search for auditor testing and treated as IPE.
- **Regulatory**: AS 2401 JE testing requires the complete population with preparer, approver, created/posted timestamps, source, reconcilable to opening and closing trial balances. France FEC prescribes an 18-field flat export of every entry, validated for sequential completeness, delivered within 15 days of an audit notice. Germany GoBD requires "Unveränderbarkeit" (unalterability) with machine-analyzable data access. SAF-T countries (PT/PL/NO/RO) require the same data as standardized XML.
- **Rationale**: one schema investment — append-only posted journals, reversal-only correction, preparer/approver/timestamps on every entry, gapless numbering, flat full-population export — satisfies four regimes at once.

### 2. Multi-GAAP = a ledger/book dimension on every journal line

- **SAP**: ledger approach — leading ledger 0L + non-leading ledgers per accounting principle (IFRS/local GAAP/tax); ACDOCA's primary key includes the ledger; ordinary postings fan out to all ledgers, valuation postings target a ledger group; extension ledgers store deltas only. Asset accounting: one depreciation area per valuation, each posting to its ledger in real time.
- **NetSuite**: Multi-Book Accounting — primary book + secondary books with book-specific COA mappings, calendars, base currencies, rev-rec and depreciation rules; Adjustment-Only Books as the lightweight delta variant.
- **Regulatory**: every foreign subsidiary files statutory accounts under local GAAP while the group consolidates under US GAAP (or IFRS); IFRS 16 vs ASC 842 alone forces the same lease to produce different P&L per book; IAS 2 requires NRV write-down reversals US GAAP forbids. Bolting a book dimension on later is one of the most expensive ERP retrofits.
- **Rationale**: model "book/ledger" as a first-class posting dimension from the start, even if v1 ships with exactly one book per company. An adjustment-only (delta) book is the pragmatic first parallel book.

### 3. Hard close is a state machine with permissions, not a date check

- **SAP**: posting period variants — open/close intervals per account type (GL/AR/AP/assets/materials) with an authorization group so only designated users post during the closing window; special periods 13–16 layer audit/tax adjustments on period 12 without reopening operations.
- **NetSuite**: Period Close Checklist with ordered tasks (Lock A/R → Lock A/P → Lock All → eliminations → FX revaluation → rev rec → GL audit numbering → consolidated rates → Close); *locked* (overridable with the Override Period Restrictions permission) vs *closed* (immutable until explicit reopen) are distinct states; reopening cascades — all later closed periods reopen and the checklist redoes.
- **Regulatory**: auditors test who can post to closed periods and whether close/reopen is permissioned and logged; 10-K/Q deadlines (60/40-day regime as an accelerated filer) require a repeatable 5–10 business-day hard close.
- **Rationale**: period status must be enforced at the posting engine (DB/edge layer), never only in app code; locked-vs-closed distinction plus a permissioned override is the industry contract; close itself is a checklist entity with owners, dependencies, and evidence.

### 4. JE approval: parked → approved → posted, no self-approval

- **SAP**: Verify General Journal Entries workflow — manual journals park until routed approval (amount/company/account criteria, multi-level); requester ≠ approver enforced; tolerance groups additionally cap posting amounts per user group.
- **NetSuite**: native JE approval routing or SuiteFlow (up to 3 levels, Pending Approval → Approved before posting), covering JEs, intercompany JEs, statistical journals.
- **Regulatory**: auditors specifically test whether submitter and approver credentials are the same person and the time gap between them; manual and top-side entries are the mandatory fraud-testing population; system-enforced preparer ≠ approver is the cheapest "IPO-ready" differentiator.
- **Rationale**: approval must be a posting-state gate in the engine, with amount/account routing, and the system — not policy — blocks self-approval.

### 5. FX: remeasurement and translation are two different machines

- **SAP**: parallel currency amounts (document/local/group) stored on every line at posting time; FAGL_FCV revalues open items and FX balances per valuation area (per ledger) with auto-reverse or delta logic = ASC 830 remeasurement; FAGL_FC_TRANS translates balances for consolidation = translation; Group Reporting posts CTA to dedicated FS items in OCI using per-item translation keys (closing/average/historical).
- **NetSuite**: subsidiary base (functional) currency immutable once posted; Consolidated Exchange Rates table with Current/Average/Historical rate types, each account tagged with a general rate type and a cash-flow rate type; "Revalue Open Foreign Currency Balances" is a standard close task (unrealized G/L); CTA is a system account posted automatically during consolidation.
- **Regulatory**: ASC 830/IAS 21 — functional currency per entity; remeasurement gains/losses in net income; translation plug to CTA in OCI; historical-rate memory on equity and non-monetary accounts; CTA rollforward disclosure.
- **Rationale**: store transaction + base (+ group) amounts per line at posting; run period-end unrealized revaluation of open AR/AP/bank as a close task posting reversible entries; keep consolidation translation separate, driven by per-account rate types, with CTA posted (not a display-time plug) so it rolls forward.

### 6. Intercompany: stamp the partner at entry; eliminate on a dedicated entity

- **SAP**: trading partner stamped on original postings enables automated two-sided eliminations (IC AR/AP, revenue/COGS); ICMR matches continuously during the period; consolidation of investments computes goodwill and NCI from ownership percentages.
- **NetSuite**: intercompany framework — paired IC customer/vendor records, IC JEs with per-subsidiary balancing and auto due-to/due-from, "Eliminate" line flag, elimination subsidiaries per parent node, netting workbench and settlements.
- **Rationale**: Carbon already has the right skeleton (partner ID on journal lines, elimination entities, matching RPC). The consensus additions: tolerance-based matching (not exact-amount), FX-difference handling on IC pairs, document-level mirroring (IC PO↔SO), netting, and ownership percentages for NCI when below-100% subsidiaries appear.

### 7. Tax is an engine with jurisdictions, codes, and a liability account — never a flat percent

- **SAP**: per-country tax calculation procedures (condition schemas), 2-char tax codes binding rates + GL accounts, US jurisdiction codes, external-engine mode (TAXUSX → Vertex/Avalara).
- **NetSuite**: SuiteTax — nexus determination per subsidiary registration, line-level rules, per-nexus pluggable third-party engines, exemption certificates.
- **Regulatory**: VAT place-of-supply/reverse-charge/zero-rating logic, multiple concurrent registrations per entity, VAT returns + EC Sales Lists + Intrastat, withholding tax with treaty rates; output/input tax must post to dedicated liability/receivable accounts to be reportable.
- **Rationale**: minimum viable structure is taxCode → rates by jurisdiction + validity date, posting to dedicated tax payable/receivable accounts, an external-engine escape hatch for US sales tax, and returns as extracts per registration.

### 8. E-invoicing/statutory is an adapter framework with a submission state machine

- **SAP**: Document and Reporting Compliance — one framework generating legal formats (FatturaPA, CFDI, PEPPOL, SAF-T, FEC, VAT returns) with a per-document submission monitor (55+ countries).
- **Regulatory timeline pressure**: France issue-mandate Sept 2026 (SMEs 2027); Poland KSeF Feb/Apr 2026; Germany receive since 2025, issue 2027–28; EU ViDA intra-EU DRR July 2030; Italy/Mexico/Brazil/India clearance models already mandatory. Peppol BIS 3.0 / EN 16931 is the safest architectural bet. Gapless legal invoice series per country, rectification-only corrections, digital signatures where mandated, 7–10+ year retention.
- **Rationale**: the ERP must generate structured invoices per country format, track clearance status (submitted/accepted/rejected/corrected), receive structured supplier invoices, and enforce legal numbering series — typically via a middleware partner (Avalara/Sovos/Pagero) behind one internal adapter interface.

## Answers to Research Questions

1. **What gates "IPO-ready" claims for the ERP itself?** (NetSuite research) — complete JE population export with preparer/approver/timestamps; System-Notes-grade field-level audit trail; gapless GL numbering; JE approval with no self-approval; period close discipline with restricted override/reopen; user-access reports for quarterly reviews; documented SoD matrix over roles; and the vendor's own SOC 1 Type II for ITGC reliance.
2. **What does even the reference mid-market system NOT build?** — reconciliation certification workbooks (BlackLine/FloQast), SEC drafting/iXBRL (Workiva/DFIN), cap table & ASC 718 expense (Carta/Shareworks), ASC 740 provision (OneSource/Corptax/Bloomberg), US sales-tax rate content and filing (Avalara/Vertex), preventive SoD analysis (Fastpath/Strongpoint), payroll. The ERP's obligation is clean feeds: TB by entity/period/book via API, full JE export, controlled JE import with approval, tax-calc hooks at invoice time.
3. **How do the references structure multi-entity?** — subsidiary tree with per-entity immutable functional currency; elimination entities per parent node; consolidation = translate (per-account rate types) → eliminate (partner-stamped) → CTA posted; NCI/goodwill only when ownership < 100% enters the picture (SAP C/I; NetSuite does 100% summation like Carbon — NCI is an SAP-tier feature).
4. **How is period close controlled?** — two-state locked/closed with permissioned override, cascade-on-reopen, ordered close checklist with the FX-revaluation/eliminations/rev-rec/consolidated-rates tasks in it; SAP adds per-account-type windows and special adjustment periods.
5. **What must the system produce per US GAAP standard?** — 606: performance obligations, SSP allocation, rec schedules, contract asset/liability rollforwards, RPO disclosure; 842/IFRS 16: ROU/liability amortization schedules per book, maturity analysis; 718: import surface for grant-level expense JEs by entity/cost center; 740: TB mapped by legal entity + jurisdiction, book-tax difference detail, taxes paid by jurisdiction (ASU 2023-09); 830: functional currency, remeasurement vs translation, CTA rollforward; 280 (ASU 2023-07): segment dimension incl. significant expense categories, even for single-segment filers; 330: absorption costing, LCNRV write-downs (no reversal under GAAP, reversal required under IAS 2 — book-dependent); 805: fair-value opening balance sheets and measurement-period adjustments.
6. **What vendor-level assurance is required?** — SOC 1 Type II is non-negotiable (customers' auditors rely on it; without it every customer takes a control gap); SOC 2 Type II and ISO 27001 for procurement; product certification of invoicing in some countries (Portugal AT, France PDP accreditation).

## Ecosystem: Build-vs-Integrate Boundary

**The modern mid-market GL baseline (Sage Intacct / D365 Finance):** dimension-tagged GL (thin COA + ~8 standard dimensions + user-defined) instead of segment-coded accounts; multi-entity with automated due-to/due-from and continuous consolidation incl. auto-eliminations into an elimination entity; automated ASC 830 CTA on shared non-closing equity accounts (Intacct Global Consolidations); multi-book (Intacct: cash/accrual + unlimited user-defined books; D365: 10 posting layers); close workspace with checklists/owners/dependencies and per-module period locking; allocations engine; rev-rec module with SSP allocation and contract-modification recalc. Carbon's dimension-based journal design is already on the right (Intacct-style) side of this divide.

**Market timing:** companies graduate from QuickBooks/Xero at roughly $5–30M revenue / Series B–C, triggered by multi-entity consolidation (the #1 trigger), rev-rec shadow spreadsheets, first audit/diligence, and inventory complexity — Carbon's manufacturing customers hit the inventory trigger earliest. Companies almost never leave NetSuite below ~$500M revenue; they IPO on it and surround it with bolt-ons. Systems must be in place 9–12 months pre-IPO (83% of IPO companies had scalable ERP deployed ≥1 year prior). AI-native GL competitors (Campfire, Rillet, Light, Puzzle — each $40M–$100M+ raised in 2025) all compete on exactly this: modern multi-entity GL + automated rev rec + AI close, with SOC 1/SOC 2 Type II as table stakes; none has manufacturing depth, which is Carbon's wedge.

**ERP-native (Carbon must build):** GL/multi-book, consolidation + eliminations + CTA, period close controls, JE approval/audit trail, AR/AP with payment controls, fixed assets + leases (leases increasingly ERP-native at mid-market), indirect-tax posting structure, deferred revenue/rev-rec schedules, inventory valuation incl. LCNRV, statutory export surfaces (SAF-T/FEC/JE population), dimensions/segments, flux-capable comparative reporting.

**Ecosystem (Carbon integrates, never builds):** reconciliation certification & close orchestration evidence (BlackLine/FloQast — though a native close checklist is expected), SEC/iXBRL (Workiva), equity/718 (Carta), tax provision/740 (OneSource et al.), US sales-tax content/filing (Avalara/Vertex — Carbon builds the hooks), AP payment execution rails (Tipalti/bill.com or bank files), payroll (providers post summarized JEs), FP&A (Adaptive/Pigment), expense (Ramp/Brex).

**Integration surfaces the ERP must expose:** per-entity/period/book trial balance API; full JE-line export (flat, no row caps); controlled JE import API that respects approval workflow and period status (this is how Carta/payroll/provision adjustments land); tax-calculation hook at document pricing/posting time; webhook/event stream for close-status and posting events.

## Competitor-Specific Details

### NetSuite
Subsidiary cap 250; elimination subsidiaries excluded from cap; CTA a system account; Consolidated Exchange Rates auto-calculated as a close task; Multi-Book provisioned by professional services (i.e., hard to retrofit even for them); SuiteTax enablement irreversible; "Allow Non-G/L Changes" period flag lets memo-level edits in closed periods without GL impact — a nice controlled-flexibility pattern; intercompany netting via a workbench generating paired settlements.

### SAP S/4HANA
ACDOCA merges GL + subledger analytics so no reconciliation between them can diverge; segment derived from profit center master data (users never key segments); document splitting with zero-balancing per segment for sub-entity balance sheets; extension ledgers for delta books; firefighter break-glass access with session recording and post-hoc review; per-user tolerance groups (amount limits) orthogonal to role permissions; three-layer COA (group ↔ operating ↔ country-statutory alternative account numbers) — do NOT fork the chart per country.

## Recommended Approach for Carbon

1. **Journal integrity first** (SAP immutability + NetSuite System Notes): DB-level append-only posted journals, preparer/approver columns, gapless per-entity numbering, full-population export. Serves SOX + FEC + GoBD + SAF-T at once.
2. **Hard close as a posting-engine gate** (NetSuite locked/closed states): enforce in the edge functions and RLS, not app code; close checklist entity; permissioned override + logged reopen with cascade.
3. **JE approval state machine** (SAP parked→posted): approval rules by amount/account; system-enforced preparer ≠ approver; extend the existing approvalRule engine rather than building new.
4. **Ledger/book dimension on journalLine now, one book per company in v1** (SAP ledger approach, NetSuite adjustment-only books as the first parallel book): schema cost is small today, enormous later.
5. **Per-line currency memory** (SAP parallel currencies): store transaction currency + amount alongside base on journalLine; unrealized FX revaluation as a close task; post CTA rather than plugging it at display time; write the missing `exchangeRateHistory` feed.
6. **Tax subledger** (SuiteTax-lite): taxCode/jurisdiction/rate tables, output/input tax posting to liability accounts, exemption enforcement, external-engine hook; returns as extracts.
7. **E-invoicing adapter framework** (SAP DRC pattern via middleware partner): EN 16931/Peppol core, country adapters, clearance-status state machine, legal numbering series.
8. **Leave to ecosystem, expose feeds**: recs certification, SEC/XBRL, equity, provision, payroll, payment rails — build the TB/JE APIs and controlled JE import instead.

## Sources

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N278654.html (Consolidated Reporting in OneWorld)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1405625.html (Consolidated Exchange Rate Types)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1406908.html (Calculating Consolidated Exchange Rates Automatically)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N268563.html (Subsidiaries in OneWorld)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_3831567542.html (Multi-Book Accounting Overview)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3851620232.html (Chart of Accounts Mapping)
- https://www.netsuite.com/portal/resource/articles/accounting/multi-book-accounting.shtml (What Is Multi-Book Accounting)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4328435538.html (Advanced Revenue Management)
- https://timdietrich.me/blog/netsuite-revenue-recognition-arm/ (ARM data model)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1486393.html (Automated Intercompany Management)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_158142795285.html (Intercompany Framework)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_158945626309.html (Intercompany Netting)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html (Period Close Checklist)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1452509.html (Accounting Period Close)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457543.html (Reopening a Closed Period)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1471271.html (Journal Entry Approval)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_158644279544.html (System Notes)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N557476.html (Line-Level Audit Trail)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1543968584.html (Fixed Assets Lease Accounting)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2126441.html (Fixed Assets Management)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0315035511.html (SuiteTax vs Legacy Tax)
- https://technologyblog.rsmus.com/technologies/netsuite/system-audit-functionality-in-netsuite/ (audit functionality)
- https://technologyblog.rsmus.com/technologies/netsuite/tax-engine-comparison/ (tax engine comparison)
- https://www.houseblend.io/articles/netsuite-erp-ipo-readiness-guide (IPO readiness)
- https://www.houseblend.io/articles/netsuite-public-company-compliance (public company compliance)
- https://www.houseblend.io/articles/netsuite-sec-reporting-workiva-activedisclosure-certent (SEC bolt-ons)
- https://www.houseblend.io/articles/asc-740-tax-provision-automation-netsuite (ASC 740 gap)
- https://nuagecg.com/blog/netsuite-sox-compliance-guide/ (SOX guide)
- https://nuagecg.com/blog/the-netsuite-access-controls-checklist-your-auditor-actually-wants-to-see (access reviews)
- https://mysuite.tech/blog/netsuite-segregation-of-duties (native SoD limits)
- https://netwrix.com/en/resources/blog/netsuite-segregation-of-duties/ (SoD)
- https://www.gofastpath.com/blog/how-to-manage-segregation-of-duties-in-your-netsuite-environment (SoD bolt-ons)
- https://www.blackline.com/erp-integration/netsuite-integration/ (BlackLine + NetSuite)
- https://www.ledge.co/content/the-hidden-gaps-in-netsuite-floqast-and-blackline-how-weve-built-ledge-to-solve-them (close-execution gap)
- https://www.netsuite.com/portal/products/erp/epm.shtml (NetSuite EPM)
- https://carta.com/equity-management/cap-table/financial-reporting/ (ASC 718 via Carta)
- https://plative.com/netsuite-for-ipo-success/ (IPO adoption statistics)
- https://www.mgocpa.com/perspective/how-to-elevate-your-companys-ipe-documentation-to-optimize-sox-compliance/ (IPE documentation)

### SAP S/4HANA
- https://blog.sap-press.com/what-is-saps-universal-journal (Universal Journal)
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/understanding-the-universal-journal-in-sap-s-4hana/ba-p/13345726
- https://help.sap.com/docs/SAP_ERP/17ec785ed2294431b933daf9a926af80/4911c9cc2a934a18e10000000a42189b.html (Document Splitting)
- https://help.sap.com/docs/SAP_ERP/17ec785ed2294431b933daf9a926af80/6b63c7531dc61d4be10000000a174cb4.html (Segment)
- https://www.iasplus.com/en/standards/ifrs/ifrs8 (IFRS 8)
- https://blogs.sap.com/2020/10/23/parallel-accounting-account-based-approach-ledger-based-approach-configuration-steps/ (Parallel accounting)
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/in-depth-with-sap-s-4hana-ledger-scoping-q-amp-a/ba-p/13571167 (Ledger scoping)
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/67e323b7117e4c91869c258933f47182/dd214452ab903607e10000000a441470.html (Ledger Approach in Asset Accounting)
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/sap-s-4hana-currency-setup/ba-p/13379639 (Currency setup)
- https://blog.sap-press.com/defining-currency-types-for-the-general-ledger-in-sap-s4hana (Currency types)
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/651d8af3ea974ad1a4d74449122c620e/8450d7531a4d424de10000000a174cb4.html (Foreign Currency Valuation)
- https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361878651.html (FAGL_FC_VAL Delta Logic)
- https://community.sap.com/t5/enterprise-resource-planning-q-a/fagl-fc-trans-vs-fagl-fc-val/qaq-p/11438393 (Translation vs valuation)
- https://blog.sap-press.com/what-is-currency-translation-in-sap-s4hana (Group Reporting currency translation)
- https://eursap.eu/blog/sap-group-reporting-currency-translation-backbone-of-sap-group-reporting (CTA)
- https://learning.sap.com/learning-journeys/performing-consolidation-with-sap-s-4hana-cloud-for-group-reporting/consolidating-investments_de91a380-d9a9-4781-9adc-43faee325dc4 (Consolidation of investments, NCI)
- https://sapsharks.com/ob52-open-and-close-fi-posting-periods/ (OB52 posting periods)
- https://learning.sap.com/courses/customizing-core-settings-in-financial-accounting-in-sap-s4hana/managing-posting-periods (Posting periods)
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8b1d76cd5e7644caa0553fcf338f3982/3fe49e8767d648a6b1b5edeec8849b8d.html (Financial Closing cockpit)
- https://blogs.sap.com/2022/03/01/sap-s-4hana-cloud-for-advanced-financial-closing-enhanced-task-list-management/ (AFC)
- https://pathlock.com/blog/sap-grc/sap-access-control/ (GRC Access Control)
- https://learning.sap.com/learning-journeys/discovering-the-main-functionalities-of-sap-access-control/building-a-rule-set_b02d61c0-e8aa-48ed-81ae-ea65d320798e (SoD rulesets)
- https://blogs.sap.com/2020/03/15/verify-general-journal-entries-configuring-the-workflow-in-s-4hana-1909/ (JE verification workflow)
- https://www.learntosap.com/SAP-CDHDR-CDPOS-Tables.html (Change documents)
- https://www.stechies.com/types-of-tolerance-groups-in-fi/ (Tolerance groups)
- https://learning.sap.com/learning-journeys/implementing-record-to-report-in-sap-s-4hana/identifying-the-chart-of-accounts-types (COA types)
- https://userapps.support.sap.com/sap/support/knowledge/en/3405359 (Local COA)
- https://blog.sap-press.com/enterprise-structure-elements-for-taxes-within-sap-s4hana (Tax procedures)
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8999cee59b7c44fdb53fbbb4d703f8e6/44bed153e8b34208e10000000a174cb4.html (Tax jurisdiction)
- https://blog.sap-press.com/what-is-sap-document-and-reporting-compliance-sap-drc (DRC)
- https://www.pikon.com/en/blog/statutory-reporting-sap-s4hana-document-and-reporting-compliance/ (DRC statutory)

### Regulatory
- https://www.gaapdynamics.com/auditing-fraud-risk-journal-entry-testing/ (AS 2401 JE testing)
- https://www.bakertilly.com/insights/successfully-navigating-sox-404b (SOX 404(b))
- https://compliancestack.ai/guides/sox-section-404-testing (SOX testing)
- https://www.sailpoint.com/identity-library/it-general-controls (ITGC)
- https://support.auditsight.com/hc/en-us/articles/32044532144909-Journal-Entry-Testing-FAQs (JE extracts)
- https://greenskiesanalytics.com/the-complete-list-of-je-tests/ (JE analytics)
- https://arch.bdo.com/revenue-recognition-under-asc-606 (ASC 606)
- https://finquery.com/blog/asc-842-summary-new-lease-accounting-standards/ (ASC 842)
- https://pro.bloombergtax.com/insights/provision/asc-740-stock-based-compensation/ (740/718 interplay)
- https://www.bdo.com/insights/tax/improve-transparency-under-asc-740-new-income-tax-disclosures-asu-2023-09 (ASU 2023-09)
- https://www.equitymethods.com/articles/impact-of-asu-2023-07-on-segment-reporting-for-equity-compensation/ (ASU 2023-07)
- https://www.gaapdynamics.com/overview-of-foreign-currency-translation-under-asc-830/ (ASC 830)
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/foreign_currency/foreign_currency__2_US/chapter_1_framework__US/13_framework_for_the_US.html (PwC FX framework)
- https://www.houseblend.io/articles/asc-330-inventory-valuation-write-downs (ASC 330 / LCNRV)
- https://kpmg.com/us/en/articles/2023/ifrs-vs-us-gaap-component-approach.html (IAS 16 components)
- https://www.wallstreetprep.com/knowledge/us-gaap-vs-ifrs-differences-similarities-examples-pdf-cheat-sheet/ (GAAP vs IFRS)
- https://www.mayerbrown.com/-/media/files/perspectives-events/publications/2025/12/2026-sec-filing-deadlines-and-financial-statement-staleness-dates.pdf (SEC deadlines)
- https://www.sec.gov/divisions/corpfin/guidance/interactivedatainterp (iXBRL)
- https://www.law.cornell.edu/cfr/text/17/240.13a-15 (disclosure controls)
- https://www.workiva.com/solutions/financial-close-reporting (Workiva model)
- https://www.e-invoice.app/blog/global-e-invoicing-compliance-2026 (e-invoicing mandates)
- https://www.fiskaly.com/blog/e-invoicing-mandates-in-europe-2026 (EU mandates)
- https://tradeshift.com/resources/compliance-fr/france-e-invoicing-update-2026-tradeshift-pa-multinationals/ (France 2026)
- https://ecosio.com/en/blog/germany-e-invoicing-explained/ (Germany)
- https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en (ViDA)
- https://www.vatupdate.com/2025/05/18/briefing-document-saf-t-implementation-across-europe/ (SAF-T)
- https://invoicedataextraction.com/blog/france-fec-fichier-ecritures-comptables (FEC)
- https://www.fiskaly.com/blog/understanding-gobd-compliant-archiving (GoBD)
- https://www.avalara.com/us/en/vatlive/country-guides/europe/uk/making-tax-digital.html (UK MTD)
- https://www.fiskaly.com/blog/fiscalization-atcud-qes-in-portugal (Portugal ATCUD/QES)
- https://linfordco.com/blog/what-is-soc-1-report/ (SOC 1)
- https://www.dsalta.com/resources/soc-2/sox-compliance-saas-vendors-guide-2026 (SaaS vendor SOX)
- https://www.a-lign.com/articles/what-is-soc-2-complete-guide (SOC 2)

### Ecosystem / mid-market baseline
- https://www.sage.com/en-us/sage-business-cloud/intacct/product-capabilities/extended-capabilities/financial-reporting/multi-dimensional-system/ (Intacct dimensions)
- https://www.sage.com/en-us/sage-business-cloud/intacct/product-capabilities/core-financials/multi-entity/ (Intacct multi-entity)
- https://www.intacct.com/ia/docs/en_US/help_action/Consolidations/Global_Consolidations/Book_setup/CTA-accts.htm (Intacct CTA accounts)
- https://www.claconnect.com/en/resources/blogs/sage/sage-intaccts-multi-book-architecture (Intacct multi-book)
- https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/financial-dimensions (D365 dimensions)
- https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/elimination-rules (D365 eliminations)
- https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/financial-period-close-workspace (D365 close workspace)
- https://www.blackline.com/products/financial-close/ (BlackLine)
- https://www.floqast.com/integrations (FloQast ERP surface)
- https://developer.avalara.com/erp-integration-guide/about-this-guide/core-requirements/ (Avalara ERP integration requirements)
- https://www.glencoyne.com/guides/carta-accounting-sync (Carta JE sync)
- https://help.tipalti.com/hc/en-us/articles/30710248001303-Synchronization (Tipalti ERP sync)
- https://docs.ramp.com/developer-api/v1/guides/accounting (Ramp accounting API)
- https://technologyblog.rsmus.com/netsuite/exporting-full-gl-detail-auditor/ (auditor GL extract)
- https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-subscriptions/learn-usage-limits-quickbooks-online/L6THMltE4_US_en_US (QBO limits)
- https://eightx.co/blog/netsuite-vs-quickbooks-when-to-graduate (graduation thresholds)
- https://www.brokenrubik.com/blog/netsuite-vs-oracle-fusion-cloud-erp (leaving NetSuite)
- https://www.pwc.com/us/en/industries/tmt/library/tech-ipo-readiness.html (IPO systems timing)
- https://techcrunch.com/2025/06/30/tiny-ai-erp-startup-campfire-is-winning-so-many-startups-from-netsuite-accel-led-a-35m-series-a/ (Campfire)
- https://www.rillet.com/product/enterprise-security (Rillet SOC posture)
- https://light.inc/ (Light)
- https://puzzle.io/ (Puzzle)
