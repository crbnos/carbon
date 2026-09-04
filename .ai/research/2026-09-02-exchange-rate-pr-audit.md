# Exchange-Rate PR Audit — BettrCallRaul, 2026-08-31..2026-09-02

Audit of 12 currency/exchange-rate bug-fix PRs, treated as symptoms of the architecture
about to be refactored: `currency` scoped to `companyGroupId` (while companies in a group
can have different base currencies), and exchange rates populated only by an integration
(so rates are missing/stale/1.0 by default).

Root-cause classes:
- **(a)** currency/rates normalized to `companyGroupId` while group members have different base currencies
- **(b)** rates only exist via integration → missing/stale/1.0 defaults
- **(c)** document-level `exchangeRate` snapshot vs live currency-table rate confusion
- **(d)** direction confusion (multiply vs divide; rate is foreign-per-base)
- **(e)** missing rate propagation (header→line, document→PDF/email/sync payload)
- **(f)** validation gaps (0/negative/null/unchecked errors)
- **(g)** other — two named recurring "others": **(g1)** `(currencyCode, exchangeRate)` not treated as an atomic pair; **(g2)** dual parallel column families (base `unitPrice` vs `converted*`/`supplier*` generated mirrors) with no type-level distinction, making wrong-column selection invisible

## Summary table

| PR | State | Symptom | Root-cause class | Recommendation |
|----|-------|---------|------------------|----------------|
| #1549 | OPEN | Reprinting a quote after the rate cron ran mixed two rates on one PDF: lines at the quote's snapshot, header shipping/charges at today's live rate; total reconciled to neither | **(c)** primary; (b) enabling (`let exchangeRate = 1` + live lookup) | **Merge first**; refactor subsumes under a "document snapshot always wins on documents" contract |
| #1548 | OPEN | Sales-order and PO emails printed the BASE unit price labelled with the document currency; qty × unit ≠ line total on the same row, sent to customers/suppliers | **(e)** primary; (g2) enabling | **Merge first** (wrong numbers leaving the building); refactor subsumes if column families get typed |
| #1547 | OPEN | EUR invoice on USD-base company synced to Xero/Rillet with USD amounts declared as EUR; provider revenue/AR/FX all wrong by the rate | **(e)** primary; (g2) enabling; (d) appeared and was reverted mid-branch (CurrencyRate inversion) | **Merge first**; refactor must generalize — PR itself names the same defect still open in Xero SO/PO, QBO invoice/bill/PO/payment, Rillet bill |
| #1544 | OPEN | Foreign-currency receipts with header shipping capitalised cost wrong by rate² into `costLedger` + weighted-average item cost (multiply instead of divide) | **(d)** | **Merge first** (irreversible valuation corruption); refactor subsumes via to-base/from-base helpers |
| #1543 | OPEN | Supplier part prices prefilled into PO/invoice lines wrong by rate² (SEK 1,290 instead of SEK 162,980) — divided base→supplier where multiply was correct, then divided again on price breaks | **(d)** primary; (g2) enabling (`supplierPart` price columns have no currency column — implicitly base) | **Merge first**; refactor subsumes by giving stored prices an explicit currency |
| #1542 | OPEN | Group with companies on different base currencies + active integrations: nightly job rebased the SHARED currency rows once per company; last writer won, rates flipped nightly | **(a)** primary; (b) is the delivery mechanism | **Refactor supersedes** — this enforces exactly the invariant (one base per group) the refactor must decide; merge only as a stopgap if the refactor is weeks out |
| #1541 | OPEN | A typed/imported 0 or negative rate saved silently; 0 zeroes every sales `converted*` column, purchasing substitutes par | **(f)** | **Merge first, refactor keeps** — DB CHECKs on 12 document tables survive any re-architecture |
| #1532 | OPEN | Sales invoice summary multiplied the base-stored header shipping by the rate on the BASE side, overstating the base total | **(d)** (converted a value already in base); (g2) enabling | **Merge first**; one line, independent of everything else |
| #1530 | OPEN | Crafted POST to any of six `*.exchange-rate` routes stamps another currency's rate onto a document that keeps its own code (SEK rate on a USD invoice) | **(g1)** primary; (f) (trusting client input); (c) adjacent (defines "refresh" semantics) | **Merge after #1526** (stacked on its `resolveCurrencyAndRate`); refactor subsumes the resolver |
| #1527 | OPEN | Refreshing a sales invoice rate updated the header only; lines (and their `converted*` columns) kept stale rates; PDF total existed at no rate; new lines stranded at DEFAULT 1 | **(e)** (header→line cascade missing on 1 of 6 documents) | **Merge first**; refactor may supersede if line-level rates are eliminated — flag "rate 1 = unset" tradeoff as a design input |
| #1526 | OPEN | Six bulk-update routes set `currencyCode` without `exchangeRate`: party reassignment kept rate 1 (foreign customer quoted at par); the `currencyCode` case fell through to the generic setter | **(g1)** primary; (b) (missing rate → fabricate 1); (f) | **Merge first**; refactor absorbs `resolveCurrencyAndRate` as the seed of the new currency service |
| #1525 | MERGED | RFQ→Quote for a foreign-currency customer silently quoted at par: currency lookup still filtered on the DROPPED `companyId` column, error unchecked, `?? 1` | **(a)** primary; (f) (unchecked error); (b) (default-to-1) | Merged. Refactor should sweep for remaining stale per-company assumptions on group-scoped tables |

## Per-PR detail

### #1549 — fix(sales): print the quote PDF at the quote's own exchange rate (OPEN)

1. **Symptom**: One quote PDF mixed two exchange rates. Line amounts render from `converted*`
   generated columns (baked at the quote's stored rate); header shipping and add-on charges
   were converted at the LIVE currency-table rate. The moment the daily cron moved the
   currency, the total reconciled to neither, and reprinting an old quote silently changed it.
2. **Proximate cause**: `apps/erp/app/routes/file+/quote+/$id[.]pdf.tsx` initialized
   `let exchangeRate = 1` and overwrote it from `getCurrencyByCode(...)` instead of reading
   `quote.data.exchangeRate`. Fix: rate comes from the quote; the currency row is read only
   for `decimalPlaces`.
3. **Root cause class**: **(c)** snapshot-vs-live confusion. (b) is the enabling condition —
   a live-table lookup only exists because the rate wasn't trusted to be on the document.
   PR notes the quote PDF was the only `file+` route passing a scalar rate (16 audited).
4. **Fix shape**: Point patch, correct direction. Merge first. The refactor should encode the
   contract this patch implies: on a document surface, the document's snapshot rate ALWAYS
   wins; the currency table is for defaults at creation and metadata (decimals).
5. **Files**: `apps/erp/app/routes/file+/quote+/$id[.]pdf.tsx` (+6/−4).

### #1548 — fix(documents): email the line unit price in the currency the email is formatted in (OPEN)

1. **Symptom**: `SalesOrderEmail` printed `salesOrderLine.unitPrice` (BASE) under the
   customer's currency label while the adjacent line total summed `convertedUnitPrice` —
   qty × unit price ≠ total on the same row. `PurchaseOrderEmail` printed the generated base
   `unitPrice` under the supplier's currency while its total summed `supplierUnitPrice`.
   These are externally sent.
2. **Proximate cause**: The formatter's currency was fixed in all three emails at some point;
   the amount column was fixed in only one (`SalesInvoiceEmail` already used
   `convertedUnitPrice`). Fix: each email formats the same column its own total helper sums
   (`convertedUnitPrice` / `supplierUnitPrice`), plus switches unit prices from the money
   formatter to a rate formatter (per the numeric-precision rate-vs-money kinds), and tests
   `!= null` instead of falsiness so zero-priced lines print.
3. **Root cause class**: **(e)** document→email payload propagation, enabled by **(g2)** —
   two parallel column families with identical types make wrong-column picks silent.
4. **Fix shape**: Point patch. Merge first. The refactor subsumes only if it types the column
   families (e.g. branded Money<Base> vs Money<Doc> at select time) or collapses them.
5. **Files**: `packages/documents/src/email/PurchaseOrderEmail.tsx`,
   `SalesOrderEmail.tsx`, `SalesInvoiceEmail.tsx` (+42/−7).

### #1547 — fix(accounting): push AR invoice amounts in the currency the payload declares (OPEN)

1. **Symptom**: Foreign-currency AR invoices synced to Xero and Rillet with base-currency
   line amounts under the document's `CurrencyCode` — a EUR invoice on a USD-base company
   ships USD numbers labelled EUR; provider revenue, AR balance and realised FX are wrong by
   the rate.
2. **Proximate cause**: Both syncers selected/pushed `unitPrice` (base). Fix selects
   `convertedUnitPrice` with fallback to `unitPrice` when null (base-currency invoices).
   Notably, an earlier commit on the same branch ALSO inverted Xero's `CurrencyRate` on a
   wrong premise and was reverted — Xero's `CurrencyRate` is foreign-per-base, same as
   Carbon's; it passes through unchanged, and is omitted (not 1) on base-currency invoices.
3. **Root cause class**: **(e)** document→sync payload, enabled by **(g2)**. The reverted
   inversion is a live demonstration of **(d)** — even the fixer got the direction wrong once.
4. **Fix shape**: Point patch + unit tests (6/6 Xero invoice suite, 3 new FX cases). Merge
   first, but the PR itself documents the same defect still open in: Xero sales-order and
   purchase-order pushes, QuickBooks invoice/bill/PO/payment mappings, Rillet bill. QBO's
   `ExchangeRate` genuinely IS base-per-foreign and is currently written un-inverted. The
   refactor must define ONE payload contract ("every amount on a payload is in the currency
   the payload declares; each provider adapter owns its rate direction") rather than
   letting each entity syncer re-derive it. Not verified against a live Xero org (no sandbox).
5. **Files**: `packages/ee/src/accounting/core/models.ts`,
   `providers/rillet/entities/invoice.ts`, `providers/xero/entities/invoice.ts` (+ tests)
   (+123/−5).

### #1544 — fix(inventory): divide receipt header shipping to base, don't multiply (OPEN)

1. **Symptom**: Every foreign-currency PO receipt carrying header shipping capitalised the
   wrong number by rate² — weighted across receipt lines into the cost-ledger layer value,
   per-piece cost, and Inventory/GR-IR journal, dragging weighted-average item cost with it.
   No later journal correction repairs `costLedger`.
2. **Proximate cause**: `post-receipt/index.ts:623` computed
   `supplierShippingCost * exchangeRate`; supplier→base is DIVIDE (rate is
   foreign-per-base). The codebase already knew: `post-purchase-invoice/index.ts:559`
   divides with an explanatory comment, and migration `20260702061504` is literally titled
   "Fix supplierShippingCost currency conversion: divide, not multiply" — it fixed the views
   but not this edge function.
3. **Root cause class**: **(d)**. Third occurrence of the exact same expression bug in the
   codebase's history — direction is re-derived at every call site.
4. **Fix shape**: Point patch (also hardens `?? 1` to `|| 1` against rate 0). Merge first —
   this is active valuation corruption. Refactor supersedes the PATTERN (a `toBase()` /
   `fromBase()` helper pair so no call site ever writes `* rate` or `/ rate` raw) but not
   this fix.
5. **Files**: `packages/database/supabase/functions/post-receipt/index.ts` (+9/−2).

### #1543 — fix(purchasing): convert supplier part prices to the supplier's currency, not away from it (OPEN)

1. **Symptom**: Adding a supplier part to a foreign-currency PO/purchase invoice prefilled a
   unit price wrong by rate² (verified: SEK 1,290.04 where SEK 162,980 was correct — 126×
   understatement). The generated base column then derives from the wrong supplier price, so
   receiving creates cost layers at the wrong magnitude.
2. **Proximate cause**: `supplierPart.unitPrice` / `supplierPartPrice.unitPrice` are stored
   in BASE (no currency column on either table). The target field `supplierUnitPrice` is
   supplier-currency, so base→supplier is MULTIPLY; both line forms divided, and
   `resolveSupplierPrice` divided AGAIN on the price-break path. Fix: `resolveSupplierPrice`
   takes base inputs, returns supplier-currency output, callers hand it raw base; the
   `fallbackUnitPrice` initializer (seeded from a supplier-currency value into a base-meaning
   field) now divides to base explicitly.
3. **Root cause class**: **(d)**, enabled by **(g2)** — a price table whose currency is
   implicit (base by convention, no column) guarantees somebody converts the wrong way.
4. **Fix shape**: Point patch that also documents the contract in `resolveSupplierPrice`'s
   JSDoc — a small step toward architecture. Merge first. The refactor should give supplier
   price rows an explicit currency (or an explicit "always base" branded type).
5. **Files**: `apps/erp/app/modules/shared/shared.service.ts` (shared helper — check for
   other callers), `purchasing/ui/PurchaseOrder/PurchaseOrderLineForm.tsx`,
   `invoicing/ui/PurchaseInvoice/PurchaseInvoiceLineForm.tsx` (+30/−14).

### #1542 — fix(jobs): rebase exchange rates once per company group, not once per company (OPEN)

1. **Symptom**: A company group whose members use different base currencies, with the
   exchange-rate integration active on more than one member: the nightly job rebased the
   SHARED group-scoped `currency` rows once per company, each overwriting the last. Rates
   flipped every night; the same document's converted totals changed day to day.
2. **Proximate cause**: `currency` is group-scoped (`20260228023426`) but `companyIntegration`
   is company-scoped; the job iterated integrations and rebased to each company's own
   `baseCurrencyCode`. Fix: group active integrations by `companyGroupId`, resolve the base
   once, rebase once, write once; REFUSE (log + throw after healthy groups complete) when a
   group's members disagree on base currency. Also: warns on feed-omitted currencies (silent
   staleness), sets `updatedBy`.
3. **Root cause class**: **(a)** — this is the purest expression of the architectural flaw:
   nothing in the schema records a group-level base currency, yet the shared rate rows can
   only express one. **(b)** is the delivery mechanism (rates only move when the integration
   job runs). The PR itself states: "That assumption was just never enforced where the rates
   are written."
4. **Fix shape**: Half-architecture: it enforces one-base-per-group by refusal at ONE writer,
   but the invariant remains unrecorded in the schema. **The refactor supersedes this** —
   whichever way the refactor goes (per-company currency rows, or a schema-level group base
   currency), this job gets rewritten. Merge only as a stopgap if the refactor is weeks out;
   if merged, note its refusal policy (throw after healthy groups) is temporary behavior the
   refactor must consciously keep or replace. Not executed end-to-end (needs
   `EXCHANGE_RATES_API_KEY` + live provider); decision logic exercised against the real schema.
5. **Files**: `packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts`
   (+99/−39).

### #1541 — fix(accounting): refuse a non-positive exchange rate at every layer (OPEN)

1. **Symptom**: A zero (or negative) exchange rate could be typed or imported and saved
   silently. Zero zeroes every sales `converted*` generated column (no zero-guard);
   purchasing's columns substitute 1, silently pricing a foreign document at par.
2. **Proximate cause**: `currency` has had `CHECK ("exchangeRate" > 0)` since 2023, and
   `payment`/`memo` since 2026-06 — but all 12 document tables were missed. The zod schema
   said `.min(0)` ("Rate is required"), and the form's `minValue={0}` CLAMPED a typed 0 to
   the step (0.00001) on blur instead of refusing. Fix: CHECK on all 12 tables (`> 0 AND
   <> 'NaN'`, NULL-tolerant where nullable, added NOT VALID + VALIDATE to avoid write-blocking
   locks), `.positive()` in zod, `minValue` unset for foreign currencies. NaN excluded
   explicitly because Postgres orders NaN above all finite values so `> 0` alone accepts it.
3. **Root cause class**: **(f)**. NULL deliberately left alone ("no rate set" is a different
   condition — a data decision for the refactor, not a schema one).
4. **Fix shape**: The most durable of the twelve — DB constraints survive any
   re-architecture. **Merge first; the refactor keeps it.** Interaction: its migration
   (`20260901161207`) validates `salesInvoiceLine.exchangeRate > 0` AFTER #1527's backfill
   migration (`20260901134416`) by timestamp order — fine if both merge, but if #1527 is
   dropped, verify no NULL/zero line rates exist before VALIDATE.
5. **Files**: migration `20260901161207_exchange-rate-positive-constraint.sql`,
   `apps/erp/app/modules/accounting/accounting.models.ts`,
   `accounting/ui/ExchangeRates/ExchangeRateForm.tsx` (+119/−4).

### #1532 — fix(invoicing): stop converting the base-currency shipping on the invoice summary (OPEN)

1. **Symptom**: Sales invoice summary's BASE-side shipping figure (and base total) was the
   stored base amount multiplied by the exchange rate — base total overstated (verified:
   €11,240 rendered where €1,000 was stored; total off by 10,240).
2. **Proximate cause**: `SalesInvoiceSummary` keeps two parallel families (base from raw
   columns, customer-facing from `converted*`); header shipping was computed identically —
   multiplied — in BOTH. `salesInvoiceShipment.shippingCost` is stored in base (the
   `salesInvoices` view adds it straight onto the base subtotal), so only the customer figure
   should convert. The purchasing sibling already did the mirror-image correctly.
3. **Root cause class**: **(d)** (converted a value that was already in the target currency),
   enabled by **(g2)**.
4. **Fix shape**: One-line point patch, explicitly independent of #1527 and the rest (no
   shared files). Merge first.
5. **Files**: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceSummary.tsx`
   (+5/−3).

### #1530 — fix(accounting): take the refresh rate from the document, not the request (OPEN)

1. **Symptom**: The six `*.exchange-rate` refresh routes read `currencyCode` from the posted
   form, looked up THAT currency's rate, and wrote only `exchangeRate` — a crafted POST could
   stamp SEK's 11.24 onto a USD invoice that keeps its USD code, mispricing every line via
   `converted*`. (The UI always posts the document's own code, so in practice it behaved as a
   refresh — the parameter carried no information the server didn't have.)
2. **Proximate cause**: Client-supplied currency trusted; code/rate pair splittable by
   construction. Fix: read the currency from the document (already loaded for the locked
   check), stop parsing the form entirely, resolve through `resolveCurrencyAndRate` so a
   refresh can't install a zero/missing rate.
3. **Root cause class**: **(g1)** pair atomicity, with **(f)** (trusting client input) and a
   **(c)** flavor — these routes are the ONE sanctioned place a live table rate overwrites a
   document snapshot, and this PR pins down that semantic.
4. **Fix shape**: Point patch **stacked on #1526** (uses its `resolveCurrencyAndRate`; branch
   needs retargeting to main once #1526 merges). Merge second. Refactor subsumes along with
   #1526's resolver. Post-fix runtime re-test of the SEK-onto-USD POST was not completed
   (browser extension disconnected); pre-fix repro was confirmed.
5. **Files**: six routes `apps/erp/app/routes/x+/{purchase-invoice,purchase-order,quote,sales-invoice,sales-order,supplier-quote}+/*.exchange-rate.tsx` (+60/−48).

### #1527 — fix(invoicing): cascade the sales invoice exchange rate to its lines (OPEN)

1. **Symptom**: `salesInvoice` was the only rate-bearing header (of six) with NO header→line
   cascade. Refreshing the rate or changing currency updated the header alone; lines — and
   every `converted*` column generated off them — stayed at creation-time rates. The PDF
   summed lines at line rates and header shipping at the header rate: a total that exists at
   no exchange rate. A line added after a rate change was stranded at the DEFAULT of 1.
2. **Proximate cause**: quote/salesOrder cascade via event interceptors; purchaseOrder/
   purchaseInvoice/supplierQuote via `AFTER UPDATE OF` triggers; salesInvoice had neither.
   Fix (migration only): backfill drifted lines, `AFTER UPDATE OF "exchangeRate"` cascade
   trigger, `BEFORE INSERT` inherit trigger — mirroring the purchaseInvoice pair exactly.
3. **Root cause class**: **(e)** header→line propagation gap. Underlying design smell for the
   refactor: lines carry their OWN `exchangeRate` at all, requiring 6 documents × 2 triggers
   of glue, and via 2 different mechanisms (interceptors vs triggers).
4. **Fix shape**: Point patch consistent with existing architecture; verified end-to-end
   locally. Merge first. **Known tradeoff inherited on purpose**: the insert trigger treats
   rate 1 as "unset", so a line can never deliberately hold rate 1 on a document whose header
   differs — the refactor should kill this ambiguity (NULL = unset, or drop line rates).
5. **Files**: migration `20260901134416_sales-invoice-rate-cascade.sql` (+61/−0).

### #1526 — fix(accounting): never write a document currency without its exchange rate (OPEN)

1. **Symptom**: Six bulk-update routes could set `currencyCode` and leave `exchangeRate`
   behind. Two paths: (1) party reassignment — quote/supplier-quote adopted the new
   customer's/supplier's currency and never touched the rate, so a quote reassigned to a
   foreign-currency customer kept rate 1 and every line stayed at the base price (and the
   cascade's `IS DISTINCT FROM` guard never fired since the rate value didn't change);
   (2) the `currencyCode` case falling through to the generic `[field]: value` setter in all
   six routes.
2. **Proximate cause**: Code and rate written independently, with `exchangeRate:
   currency.data?.exchangeRate ?? 1` fabricating par when the lookup found nothing. Fix: new
   `resolveCurrencyAndRate(client, companyGroupId, currencyCode)` in
   `accounting.ee.service.ts` resolves the pair together or refuses (also refuses 0,
   negative, Infinity), and stamps `exchangeRateUpdatedAt` so a set rate is distinguishable
   from never-set. Behaviour change: setting a currency with no configured rate now errors
   instead of silently writing rate 1 — unreachable via UI, a guard for CSV/API paths.
3. **Root cause class**: **(g1)** pair atomicity (the PR literally says "one value pair" —
   same doctrine as the taxPercent/amount pair in the numeric-precision rule), with **(b)**
   as the reason lookups come back empty (rates exist only where an integration or manual
   entry put them) and **(f)** for the `?? 1` fallback.
4. **Fix shape**: The most architectural of the app-layer PRs — `resolveCurrencyAndRate` is
   a single resolution point the refactor should absorb as the seed of its currency service
   (and extend to document creation paths, which still resolve independently). Merge first;
   #1530 stacks on it.
5. **Files**: `apps/erp/app/modules/accounting/accounting.ee.service.ts`, six routes
   `apps/erp/app/routes/x+/{purchase-invoice,purchase-order,quote,sales-invoice,sales-order,supplier-quote}+/update.tsx` (+300/−144).

### #1525 — fix(accounting): resolve quote currency by company group, not dropped companyId (MERGED)

1. **Symptom**: Every Sales RFQ → Quote conversion for a foreign-currency customer produced a
   quote at rate 1 (par), silently.
2. **Proximate cause**: `convert/index.ts` still filtered `currency` on `companyId` — a
   column DROPPED on 2026-02-28 when the table moved to group scoping. PostgREST rejected the
   filter, the error was never checked, and `?? 1` wrote par. Fix: filter on
   `companyGroupId` (matching `create/index.ts`), throw on lookup failure for non-base
   currencies (base is exempt — 1 is correct there by definition).
3. **Root cause class**: **(a)** — the group-scoping migration left a stale consumer behind
   for six months; **(f)** unchecked PostgREST error; **(b)**-flavored `?? 1` default. The PR
   swept the other two tables that moved in the same migration (`account`,
   `accountCategory`) — no other stale filters found.
4. **Fix shape**: Point patch, already merged and verified locally. For the refactor: this is
   the canary — any re-scoping of `currency` MUST include a sweep of every consumer
   (PostgREST errors on dropped-column filters are silent to callers that don't check
   `.error`), ideally plus a conformance check.
5. **Files**: `packages/database/supabase/functions/convert/index.ts` (+7/−1).

## Patterns across PRs

### Count per architectural suspect (primary / including secondary)

| Suspect | Primary | Incl. secondary | PRs |
|---------|---------|-----------------|-----|
| (a) group-scoping vs per-company base | 2 | 2 | #1542, #1525 |
| (b) integration-only rates → missing/1.0 defaults | 0 | 4 | #1526, #1525, #1549, #1542 (delivery mechanism) |
| (c) snapshot vs live rate | 1 | 2 | #1549; #1530 (defines refresh semantics) |
| (d) direction confusion (×/÷) | 3 | 4 | #1544, #1543, #1532; #1547 (reverted mid-branch) |
| (e) missing propagation (header→line, doc→PDF/email/sync) | 3 | 3 | #1527, #1548, #1547 |
| (f) validation gaps | 1 | 5 | #1541; #1526, #1530, #1525, #1542 (silent overwrite) |
| (g1) code/rate pair atomicity | 2 | 3 | #1526, #1530; #1527 (line rate drifts from header) |
| (g2) untyped dual column families (base vs converted/supplier) | 0 | 5 | #1548, #1547, #1532, #1543, #1544 (enabling condition) |

### Recurring defects, named

1. **The `?? 1` reflex** (#1525, #1526, pre-fix #1549, #1527's stranded DEFAULT 1, `|| 1` in
   #1544). Everywhere a rate can be missing, some call site fabricates par — the single most
   damaging silent failure mode, and a direct consequence of suspect (b): because rates only
   exist where an integration (or manual entry) put them, every consumer needs a fallback,
   and the fallback chosen is always 1. The refactor's highest-leverage move: make "no rate"
   an ERROR at resolution time, everywhere, with exactly one sanctioned exception (base
   currency = 1 by definition, per #1525). `resolveCurrencyAndRate` (#1526) is the seed.

2. **Direction is tribal knowledge** (#1544, #1543, #1532; #1547's reverted inversion).
   `currency.exchangeRate` is foreign-per-base, encoded in zero types and re-derived by hand
   at every call site — producing three rate² bugs and one near-miss inversion, including a
   repeat of an expression already fixed by name in migration `20260702061504`. Even the
   author of these fixes inverted Xero's rate once before reverting. The refactor should ship
   `toBase(amount, rate)` / `fromBase(amount, rate)` helpers (mirroring how
   `precision.ts` centralized rounding) and ban raw `* exchangeRate` / `/ exchangeRate` via a
   `@carbon/checks` conformance check.

3. **Untyped parallel column families** (#1548, #1547, #1532, #1543, #1544). Base
   `unitPrice`/`shippingCost` and their `converted*`/`supplier*` mirrors are all bare
   `number`; some tables (supplierPart) don't even have the mirror, storing base by unwritten
   convention. Five PRs are "picked the wrong sibling" or "converted the already-converted".
   Refactor options: branded types at the select layer, naming conventions enforced by a
   check, or collapsing to one stored currency + one conversion point per surface.

4. **(currencyCode, exchangeRate) is not atomic** (#1526, #1530, #1527). The pair can be
   split by bulk updates, crafted POSTs, and header-only refreshes — the exact "one value
   pair" doctrine the codebase already applies to taxPercent/taxAmount
   (`.claude/rules/numeric-precision.md`) but never applied to currency/rate. #1526's
   resolver plus #1527's cascade are the point-fix version; the refactor should make it
   structural (single write path, or DB-level coupling).

5. **The group-scoping half-migration** (#1525, #1542). `currency` moved to
   `companyGroupId` on 2026-02-28 with no group-level base currency to anchor it, and
   consumers/jobs were not swept: one edge function silently broke for six months (#1525),
   and the nightly job still rebased per company (#1542). This is the refactor's core
   question — either currency rows return to per-company scope, or the group grows an
   explicit base currency with #1542's one-base-per-group invariant enforced in the schema
   rather than in one job's refusal path.

6. **Propagation glue instead of a propagation design** (#1527, plus context). Six document
   headers cascade rates to lines via TWO different mechanisms (event interceptors for
   quote/salesOrder, DB triggers for the purchasing three + now salesInvoice), and one of six
   was simply missing for years. Every new rate-bearing document re-earns this bug. If lines
   kept no rate of their own, classes (e) and half of (g1) disappear.

### PR interactions and conflicts

- **#1530 is stacked on #1526** (uses `resolveCurrencyAndRate`; PR body says it needs
  retargeting to main once #1526 merges). Merge order: #1526 → #1530.
- **#1527 and #1541 are both migrations touching `salesInvoiceLine.exchangeRate`**. No file
  conflict; timestamp order (#1527 `20260901134416` before #1541 `20260901161207`) means
  #1527's backfill runs before #1541's `VALIDATE CONSTRAINT` — if #1527 is dropped or
  reordered, re-verify no non-positive/NULL line rates exist before #1541 validates. Also
  #1527's "rate 1 = unset" insert-trigger semantics and #1541's ">0" constraint are
  compatible today but both feed the refactor's "what does an unset rate mean" decision.
- **#1526 and #1541 overlap semantically** (both refuse rate ≤ 0: #1526 in the resolver and a
  route-level `exchangeRate` write guard; #1541 at zod + DB). Complementary layers, no file
  conflict.
- **#1547 and #1548 both change what sales-invoice line value goes out** (sync payload vs
  email) — consistent direction (`convertedUnitPrice`), no shared files.
- **#1543 changes `resolveSupplierPrice` in `shared.service.ts`**, a shared helper — the PR
  claims the two updated forms are the only callers; verify before merge.
- **#1532 explicitly shares no files with any other PR** in the set (per its own body,
  found while verifying #1527).
- **#1547 leaves the same defect open** in Xero SO/PO, QBO invoice/bill/PO/payment, and
  Rillet bill syncers — unfixed sibling work the refactor should fold in rather than
  awaiting six more point PRs.

### Verification caveats (for merge sequencing)

Fully verified end-to-end locally: #1525, #1543, #1532, #1527, #1526. Partially verified:
#1541 (DB layer exercised; zod layer unproven in isolation), #1530 (pre-fix repro confirmed,
post-fix runtime check outstanding), #1542 (decision logic against real schema; job not
fired). Reading-only: #1549 (quote PDF route has a PRE-EXISTING render crash on main —
`Cannot read properties of undefined (reading 'width')` — worth its own issue), #1548 (no
email harness), #1544 (declined to post into shared instance), #1547 (no Xero sandbox; PR
itself recommends a demo-org round-trip before merge).
