# Exchange Rate & Multi-Currency Architecture Research: Best Practices Survey

## Summary

Surveyed how six ERPs/accounting systems (SAP S/4HANA + Business One, NetSuite OneWorld, Dynamics 365 Business Central, Odoo, Xero, QuickBooks Online) store exchange rates, feed them automatically, let users override them, and stamp them onto documents. Strong consensus emerged on five points: (1) rates are always stored with an **explicit anchor** — either currency pairs (from→to) or a rate relative to a named reference currency — never "to an unrecorded base"; (2) rates are **effective-dated rows** (valid-from / starting-date semantics, lookup = latest row ≤ document date), never a single mutable column; (3) SMB SaaS products (Xero, QBO) prove the **on-by-default, zero-config feed** model Carbon wants — no provider selection, no API key, no off-switch, overrides as the only control; (4) the best override semantics are **manual-wins**: the feed inserts-if-absent (NetSuite) or user rates take precedence for their date (Xero), rather than last-writer-wins (Odoo/BC's acknowledged weakness); (5) documents stamp a **header-level** rate at creation, table refreshes never rewrite existing documents, and per-document override is permission-gated. Odoo's `res.currency.rate` is the closest structural template for Carbon's goal: one shared table, a technical rate relative to a reference currency, nullable company scope where company-specific rows win over global rows, and both human-readable directions computed against the *viewer's* company currency.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference: rate types, currency-pair model, triangulation, document stamping rules.
- **SAP Business One** — SMB counterpart: per-company daily rate table, hard-stop on missing rates.
- **NetSuite OneWorld** — the closest analog to Carbon's problem: one tenant with subsidiaries having different base currencies sharing one rate table.
- **Dynamics 365 Business Central** — per-company rates, quotation-pair storage, feed framework, verified from published AL source.
- **Odoo** — one shared rate table serving multi-company DBs with different base currencies; the structural template.
- **Xero / QuickBooks Online** — the UX bar: rates on by default with zero configuration.

## Key Consensus Patterns

### 1. The rate's anchor is always explicit — no "rate to an unstated base"

- **SAP**: TCURR keyed by `(rate type, from-currency, to-currency, valid-from)` — client-wide (tenant-wide), NOT per company code. A company code's local currency merely selects which pair to look up at posting time. Triangulation via a per-rate-type **reference currency** means N currencies need N rates, not N².
- **NetSuite**: one shared table keyed by `(base currency, foreign currency, effective date)`. Subsidiaries with different bases read the rows whose base matches theirs — one physical list, logically partitioned by base currency. Missing pairs fall back to inverse (1÷direct) then triangulation (opt-in).
- **Odoo**: `res.currency.rate.rate` is "units of this currency per 1 unit of the reference currency" (the rate-1 currency). Converting between any two currencies is the ratio of their rates. The base is a property of the *lookup*, not the storage.
- **BC**: per-company quotation pair (`Exchange Rate Amount` / `Relational Exch. Rate Amount`), with a `Relational Currency Code` for triangulation.
- **Rationale**: Carbon's core bug — `currency.exchangeRate` normalized to "whichever company's base the nightly job last wrote" — is a category error no surveyed system makes. Either store pairs, or store reference-currency-relative rates and derive per-company views at read time.

### 2. Effective-dated, insert-only rate rows

- **SAP**: valid-from, open-ended until superseded; future-dated rows sit inactive until their date.
- **NetSuite**: users *add* a new effective-dated row, never edit in place; lookup = latest rate ≤ transaction date.
- **BC**: `(Currency Code, Starting Date)` PK; "starting date" names the semantics.
- **Odoo**: one row per (currency, date, company) — hard uniqueness constraint.
- **Xero/QBO**: one official rate per day (Xero finalizes at 11pm org time; QBO stores one/day).
- **Rationale**: history is a first-class need (revaluation, consolidation, backdated documents, audit). A single mutable `exchangeRate` column destroys it. Carbon's unwritten `exchangeRateHistory` table shows the need was felt but never wired.

### 3. On-by-default feeds are the SMB-SaaS norm; missing rates should refuse, not fabricate

- **Xero**: XE.com hourly, on the moment multicurrency exists, **no off-switch**, no setup of any kind.
- **QBO**: IHS Markit every 4 hours, on the instant the multicurrency checkbox is ticked, no provider choice, irreversible.
- **NetSuite**: a feature checkbox (Xignite feed), included with Multiple Currencies; when off, rates go stale.
- **SAP/BC/Odoo**: feeds are configured (Market Rates Management / Exchange Rate Services / Automatic Currency Rates with default interval "Manually"); none on by default — and all generate consultant/add-on ecosystems as a result.
- **On missing rate**: SAP hard-fails (error SG105 "Enter rate X/Y for date"); B1 blocks the document; BC errors ("no Currency Exchange Rate within the filter"); QBO prompts the user to enter one. Nobody silently uses 1.0. (Odoo's 1.0 fallback exists only when a currency has no rate row at all — and is regarded as a trap.)
- **Rationale**: Carbon's ~25 `?? 1` par fallbacks are the anti-pattern every strict system refuses. "No rate" must be an error at resolution time; base currency = 1 by definition is the only sanctioned constant.

### 4. Override semantics: manual wins, feed defers

- **NetSuite** (the cleanest): the feed's write is **insert-if-absent per (pair, effective date)** — "manually entered rates for the same currency pair and effective date aren't overwritten by rate providers." No lock flag needed; the protection is structural. Per-currency "Automatic Update" checkbox opts a currency out of the feed entirely.
- **Xero**: per-document "Set exchange rate" → "XE.com rate | Custom exchange rate", with a default-on checkbox *"apply this exchange rate to all new transactions on this date"* — override where you are, optionally promote it to the date. User-set rates for a date take precedence over the feed.
- **QBO**: "market rate" vs "**your rate**" — per-transaction rates persist; company-level custom rates apply for that day only, with audit (who + when).
- **Odoo/BC** (the weakness to avoid): one row per day, feed insert-or-overwrite — a manual edit to *today's* row is clobbered by the next sync. Community workarounds exist precisely because of this.
- **Rationale**: Carbon's requirement "every rate user-overridable" maps to rate provenance (feed vs manual) + feed-defers-to-manual write discipline, not to a boolean lock column.

### 5. Documents stamp a header rate at creation; refreshes never rewrite; lines don't carry independent rates

- **NetSuite**: rate effective on the transaction date is captured into the transaction's own Exchange Rate field; header-only; editable with Currency permission at Edit level; table refreshes change *defaults for future transactions* only. Billing re-rates (invoice from SO defaults to the invoice-date rate).
- **SAP**: stamps from a role-appropriate date (pricing date for prices, billing/posting date for GL); header override has highest priority; downstream documents re-derive at their own posting dates **unless** the "Exchange Rate Fixed" indicator pins the PO's rate through GR/IR. (SD's per-condition-line rates exist only for conditions priced in a third currency — a specialized case, not a general line-rate model.)
- **BC**: posting uses the posting-date rate; per-document override via the Change Exchange Rate page (header); a per-rate-row **"Fix Exchange Rate Amount"** flag governs whether documents may override at all. The document freezes a derived **Currency Factor**.
- **Odoo**: date-based, not document-based — no supported per-document override in standard Odoo (typed rates get recomputed at confirmation); the sanctioned path is creating a dated rate row.
- **Xero/QBO**: transaction-date rate, header-level, per-document editable; changing the document date re-derives.
- **Rationale**: Carbon's six header + six line snapshot tables with three different propagation mechanisms (interceptors, triggers, none) has no counterpart anywhere. One header rate per document, with lines converting through the header rate, is universal.

### 6. Rate purposes are separated: posting vs revaluation vs consolidation

- **NetSuite**: entirely separate **Consolidated Exchange Rates** table (per period × subsidiary pair × book) with **Current / Average / Historical** values, where Average/Historical are *weighted averages of actual posted transaction rates*; every GL account carries a General Rate Type + Cash Flow Rate Type selecting which applies. Daily table and period table never share storage.
- **SAP**: named rate types (M, B, G, EURX, custom historical/budget types) over the same pair table.
- **BC**: a parallel adjustment pair on each rate row, consumed only by the Exch. Rates Adjustment batch job.
- **Odoo**: revaluation is report-time — closing-rate override typed in the report is *not* written back to the rate table; adjustment entry auto-reverses.
- **Rationale**: Carbon's `historicalExchangeRate` column and consolidation RPCs (`getConsolidationRates`, `translateTrialBalance`) are a nascent version of this separation; the refactor must not conflate transaction rates with consolidation rates.

## Answers to Research Questions

1. **Per-entity or shared rates in multi-entity systems?** Shared at tenant scope with an explicit anchor: SAP TCURR is client-wide currency pairs; NetSuite is one table partitioned by base currency; Odoo is one table with reference-relative rates + nullable company scope (company rows win over global rows — verified in source: `WHERE company_id IS NULL OR company_id = %s ORDER BY company_id, name DESC LIMIT 1`). Only BC and B1 are strictly per-company — and both are single-base-currency-per-company designs. **Nobody scopes rates to an entity *group* whose members have different bases.**
2. **Feeds on by default?** Yes in Xero/QBO (the model Carbon wants: no provider choice, no key, no off-switch); checkbox-included in NetSuite; configured in SAP/BC/Odoo. With no feed: strict systems refuse to post on a missing rate rather than fabricate one.
3. **Do manual edits survive the feed?** Best practice yes: NetSuite feed = insert-if-absent per (pair, date); Xero user-date-rates take precedence. Odoo and BC clobber same-date manual edits (documented weakness). QBO: per-day only, resumes feed next day, but per-transaction rates always persist.
4. **Direction/storage convention?** NetSuite: base units per 1 foreign unit. Odoo: reference-relative technical rate + two computed human views (`company_rate` "units per company currency", `inverse_company_rate` "company currency per unit") against the viewer's company. BC: quotation pair sidestepping direction ambiguity. SAP: per-pair standard quotation (direct/indirect) config. Consensus: pick one canonical convention, state it everywhere a rate appears, and render human-direction views per company at the edge.
5. **Document stamping?** Header-level rate captured at creation from the transaction/posting date; permission-gated per-document override; table changes affect future documents only; downstream documents re-derive at their own dates unless explicitly pinned (SAP KUFIX, B1 fixed rates). Lines never carry independent general-purpose rates.
6. **Rate types / effective dating?** Effective-dated open-ended rows everywhere; separate rate series for consolidation/revaluation (NetSuite consolidated table, BC adjustment pair, SAP types); one-rate-per-day is the SMB norm.

## Competitor-Specific Details

### SAP S/4HANA
- TCURR key: `(KURST rate type, FCURR, TCURR, GDATU valid-from)`; OB08 / "Currency Exchange Rates" Fiori app; TCURF translation ratios (per-100 quotation); reference currency per rate type wins over maintained direct rates.
- Document trio in SD: pricing rate (pricing date, `VBKD-KURSK`), accounting rate (billing date, `VBRK-KURRF`, manual header entry wins), condition-currency rate (per condition line, third-currency conditions only).
- MM: PO header `WKURS` + `KUFIX` "Exchange Rate Fixed" — pinned rate flows through goods receipt and invoice verification; unpinned re-derives at each posting date.
- FI: header rate + **translation date** (`BKPF-WWERT`, defaults to posting date, configurable per currency type in OB22).
- Missing rate = SG105 hard stop.

### SAP Business One
- Per-company-database daily rate table ("Exchange Rates and Indexes"), Local Currency + System Currency (parallel ledger currency on every posting), optional login prompt to key today's rates, missing rate blocks the document, no built-in feed (partner add-ons fill the gap).

### NetSuite OneWorld
- Currency Exchange Rates: shared, `(base, foreign, effective date)`, insert-only; feed (Xignite, ~6am account timezone) is insert-if-absent; per-currency Automatic Update opt-out; per-transaction editable header rate (Currency permission, Edit level); billing re-rates at invoice date; realized G/L at payment, unrealized at period-end revaluation.
- Consolidated Exchange Rates: per period × subsidiary pair × accounting book; Current (period-end spot) / Average / Historical (both weighted averages of actual posted transactions); GL accounts select which via General Rate Type + Cash Flow Rate Type. Plus a parallel Budget Exchange Rates table.
- Currency Exchange Rate Types feature (irreversible): named rate series (Default, Corporate, …) allowing multiple same-day rates per pair.

### Dynamics 365 Business Central
- Table 330 per company, PK `(Currency Code, Starting Date)`; quotation pair + separate adjustment pair; document freezes a Currency Factor; per-rate-row "Fix Exchange Rate Amount" governs document overridability; Exchange Rate Services = Data Exchange Framework config (FloatRates/ECB examples), enabled per service + job queue, none default; sync = insert-or-overwrite on (code, date) — manual same-date edits clobbered.

### Odoo
- `res.currency.rate`: `(name date, rate, currency_id, company_id nullable → root company)`; unique (name, currency_id, company_id); global rows (NULL company) vs company rows, company wins; currencies global, rates scoped.
- `rate` reference-relative; `company_rate`/`inverse_company_rate` computed against the row's company currency — users always type relative to their own base, storage stays canonical.
- Feed: Enterprise `currency_rate_live` (ECB default, localized central banks), interval defaults to "Manually"; OCA modules for Community; forward-only.
- No per-document override in standard Odoo (recomputed at `action_post`); revaluation closing-rate override is report-local, never written back.

### Xero
- XE.com hourly, daily official rate at 11pm org time; no off-switch, no rate API (FX contract prohibits it) — callers push `CurrencyRate` on documents or read it back; per-document override with "apply to all new transactions on this date" promotion; locked system accounts 497/498/499 (Bank Revaluations / Unrealised / Realised Currency Gains); report-date implicit revaluation.

### QuickBooks Online
- IHS Markit every 4 hours; on with the multicurrency checkbox (irreversible, home currency locks); "market rate" vs "your rate"; company-level custom rate = that day only, audited; backdating re-derives, unknown dates prompt; realized G/L auto at settlement, unrealized via manual Home Currency Adjustment; full rate API (GET/POST exchangerate) + `ExchangeRate` accepted on transactions.

## Recommended Approach for Carbon

1. **Store rates once, platform-wide, anchored to an explicit reference currency (USD), effective-dated** — Odoo's technical-rate model + NetSuite/SAP's effective dating. One `exchangeRate`-style table keyed by `(currencyCode, effectiveDate [, scope])` holding "units of currency per 1 USD"; any company's rate for any pair is the ratio of two reference-relative rates (SAP triangulation, N not N²). This dissolves the group-base ambiguity: the anchor is a property of the table, not of whichever company wrote last.
2. **Per-company override rows over global feed rows** — Odoo's nullable-company precedence: a global row (feed-written, shared by all tenants) is the default; a company-scoped row wins for that company. This is the "single store of truth for everyone, every rate user-overridable" requirement expressed structurally.
3. **Feed defers to manual** — NetSuite's insert-if-absent: the feed never touches a row a user wrote. Track provenance (`source: feed | manual` — QBO's "market rate vs your rate") instead of a lock flag.
4. **On by default, no integration** — Xero/QBO: the feed runs for everyone; the only user controls are overrides. Platform fetches rates once per day (one API call for all tenants — the reference-relative model makes tenant count irrelevant to feed cost).
5. **Kill the `?? 1` reflex** — SAP SG105: resolution of a missing rate is an error, surfaced at the point of use; the only free constant is base=1 for a company's own currency. (With a seeded global feed table, "missing" becomes genuinely exceptional.)
6. **One header rate per document, stamped at creation, refresh = explicit user action, lines convert through the header** — universal pattern; eliminates Carbon's line-rate columns and the three inconsistent propagation mechanisms. Keep `(currencyCode, exchangeRate)` atomic as a value pair (same doctrine as taxPercent/taxAmount).
7. **Keep consolidation rates separate** — do not let the transaction-rate refactor absorb `historicalExchangeRate`/consolidation semantics; NetSuite's separation (daily table vs period table) is the reference. Wire `exchangeRateHistory` (or the new effective-dated store) as the source consolidation reads from.

## Sources

- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1401566.html (NetSuite currency exchange rates)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1403894.html (NetSuite manual rates not overwritten)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4322310757.html (NetSuite rate integration)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1405625.html (NetSuite consolidated exchange rates)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1404249.html (NetSuite transaction rate override)
- https://erproof.com/fi/free-training/sap-exchange-rate-table/ (SAP TCURR)
- https://userapps.support.sap.com/sap/support/knowledge/en/3323804 (SAP direct/indirect quotation)
- https://community.sap.com/t5/enterprise-resource-planning-q-a/exchange-rate-type-reference-currency/qaq-p/6664529 (SAP reference currency/triangulation)
- https://userapps.support.sap.com/sap/support/knowledge/en/3735206 (SAP SG105 missing rate)
- https://community.sap.com/t5/technology-blog-posts-by-members/how-to-maintain-exchange-rates-in-sap-s-4hana-cloud/ba-p/13556656 (S/4HANA rate maintenance ladder)
- https://ganeshsapscm.com/2025/03/14/detailed-blog-about-exchange-rate-fixed-indicator-in-sap-purchase-order-header/ (SAP KUFIX)
- https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/45070df7e02641dfe10000000a1553f6.html (B1 exchange rates window)
- https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Finance/Currency/CurrencyExchangeRate.Table.al (BC table 330 source)
- https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Finance/Currency/MapCurrencyExchangeRate.Codeunit.al (BC sync insert-or-overwrite source)
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-update-currencies (BC rate maintenance)
- https://github.com/odoo/odoo/blob/17.0/odoo/addons/base/models/res_currency.py (Odoo res.currency.rate source)
- https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started/multi_currency.html (Odoo multi-currency)
- https://www.odoo.com/forum/help-1/different-currency-exchange-rate-for-each-company-in-multi-company-configuration-34142 (Odoo multi-company rates)
- https://www.xero.com/us/accounting-software/use-multiple-currencies/ (Xero multicurrency)
- https://xero.uservoice.com/forums/5528-accounting-api/suggestions/42351646-query-exchange-rate-through-the-api (Xero no rate API)
- https://central.xero.com/s/article/Foreign-currency-accounts-in-the-chart-of-accounts-AU (Xero system accounts)
- https://quickbooks.intuit.com/learn-support/en-us/help-article/currency/learn-exchange-rates-quickbooks-online/L97rmEAdR_US_en_US (QBO exchange rates)
- https://developer.intuit.com/app/developer/qbo/docs/workflows/manage-multiple-currencies (QBO API multicurrency)
- https://meir.prolecto.com/2019/12/03/understand-netsuites-currency-translation-approach/ (NetSuite translation approach)
- https://thedynamicsexplorer.com/2021/02/26/dynamics-365-business-central-making-sense-of-the-currency-exchange-rates-page-when-setting-exchange-rates/ (BC rate pair)
