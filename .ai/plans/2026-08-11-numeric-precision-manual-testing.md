# Numeric Precision & Formatting — Manual Testing Checklist

**Plan:** `.ai/plans/2026-08-11-numeric-precision-standard.md`
**Spec:** `.ai/specs/2026-08-11-numeric-precision-standard.md` (not in repo; the plan is self-contained)

## Prerequisites

- [ ] Migrations applied in order (`flip-purchasing-tax-percent-writable`, `widen-ledger-amounts` (15a), the purchasing cascade (15b), the tail (15c)) and types regenerated
- [ ] Dev stack running (`crbn up`); ERP + MES reachable
- [ ] A test company with: base currency USD, at least one supplier, one customer, one purchasable part, one manufactured part with a BOM containing a **picked** (Pick methodType) raw material
- [ ] For currency tests: add currencies JPY (decimalPlaces 0) and BHD (decimalPlaces 3) in Accounting → Currencies, any exchange rate
- [ ] Note: jobs created BEFORE the fix keep their old integer `estimatedQuantity` until recalculate re-runs (edit the job quantity to re-trigger). Always create FRESH documents/jobs for these tests.

---

## 1. Fractional material consumption & return

Setup: manufactured part whose BOM uses 1 EA of picked material per unit, 0% scrap.

- [ ] 1.1 Create a job for **4.5** units. Job materials: the picked material's estimated quantity is **4.5** (NOT 5).
- [ ] 1.2 Pick/issue 5 units of the material to the job (over-pick deliberately).
- [ ] 1.3 Complete the job with quantity complete 4.5; decimal input accepted in the dialog.
- [ ] 1.4 After completion: consumed = **4.5**; the return sweep puts **0.5** back (check inventory / item ledger for a 0.5 return movement).
- [ ] 1.5 Scrap regression: Make child with 1% scrap, job quantity 31 → estimated total with scrap is **32** (scrap allowance still rounds UP to whole units).
- [ ] 1.6 Discrete regression: job for 10 units behaves exactly as before (10 / 10 / 0 returned).
- [ ] 1.7 Job operations for the 4.5-unit job show operation quantity **4.5** in ERP and MES (assembly/inspection screens) — not rounded to 5.

## 2. Purchase invoice tax (the 6.25% → 6.22% bug)

Setup: new purchase invoice, line: quantity 1, unit price **$9.00**, no shipping.

- [ ] 2.1 Type **6.25** in Tax Percent → Tax Amount auto-fills **$0.56**.
- [ ] 2.2 Tab through the Tax Amount field (blur), Save, reopen: Tax Percent reads **6.25%** (NOT 6.22%), amount $0.56.
- [ ] 2.3 Amount override: set Tax Amount to **$0.57**, save, reopen: amount **$0.57** and percent **6.333%** — the pair is coupled both ways, so an amount edit re-derives the rate (`round(0.57 / 9.00)` = 0.06333). The old 6.25% is *not* retained; a stored pair that disagreed with itself is the bug this replaced.
- [ ] 2.4 Base change: quantity → 2. Amount re-derives (6.25% of $18.00 = **$1.13**); percent unchanged.
- [ ] 2.5 Fine-grained rate: **6.255%** survives blur and save, displays as **6.255%**.
- [ ] 2.6 G/L-account and Fixed-Asset line types: repeat 2.1–2.2 on the second tax pair — same behavior.
- [ ] 2.7 Zero-subtotal edge: unit price 0 — entering a percent yields $0.00, no NaN, no crash.

## 3. Purchase order tax

- [ ] 3.1 New PO line, qty 1 × $9.00: repeat 2.1–2.3 (6.25% → blur → save → reopen → 6.25%; amount override keeps rate). This exercises the PO-form seed fix — the form must read the STORED percent, not re-derive it from the amount.
- [ ] 3.2 PO totals/summary reflect the tax amount correctly.

## 4. Supplier quote tax (new capability)

- [ ] 4.1 Supplier quote line pricing shows a **Tax Percent** row beside Tax Amount (per quantity break).
- [ ] 4.2 Enter 6.25% → amount derives from that break's subtotal (qty × supplier unit price + shipping); save; reopen: rate persists.
- [ ] 4.3 Editing the Tax Amount cell keeps the stored percent (value-pair one-way rule, same as the forms).
- [ ] 4.4 Pre-migration quotes: open one — historical derived rate displays without error; editing saves the typed value.

## 5. Sales invoice tax (directly-stored column)

- [ ] 5.1 New sales invoice line qty 1 × $9.00: 6.25% → blur → save → reopen → 6.25%.
- [ ] 5.2 Unit price → $11.00: amount re-derives ($0.69); rate unchanged.
- [ ] 5.3 Fixed-asset tab: percent field accepts 6.255% and round-trips.
- [ ] 5.4 Post the invoice — totals match (subtotal + tax), no balance error.

## 6. Currency decimal places

> **Status as of 2026-08-12 — read before running this suite.** Only the **tax
> amount** field currently honours `currency.decimalPlaces`. Unit price,
> shipping and add-on entry fields, and all read-only per-unit displays, still
> fall back to Intl's CLDR default (2 for most currencies). So on a 0-decimal
> currency, 6.1 and 6.4 **will fail on every field except Tax Amount** — that is
> a known open gap (plan → Open items 1), not a new bug. Record it as
> *expected-fail* rather than filing it. Run the suite anyway: it is the
> acceptance test for that work when it lands.

- [ ] 6.1 Purchase invoice in **JPY**: amounts show **0** fraction digits (¥1,000, never ¥1,000.00); 6.25% of ¥1,000 → **¥63**. *(Today: passes on Tax Amount only.)*
- [ ] 6.2 Purchase invoice in **BHD**: **3** digits; 6.25% of BHD 9.000 → **0.563**.
- [ ] 6.3 USD amounts pad: "$4.50", never "$4.5".
- [ ] 6.4 Edit a currency's decimalPlaces (e.g. set a test currency to 0) — documents in it follow the column in both inputs and displays. *(Today: the Tax Amount field follows; the unit price does not.)*

## 7. Exchange rate precision (nightly-sync bug)

- [ ] 7.1 Trigger the exchange-rate update (Inngest `update-exchange-rates`). The **JPY** rate keeps its fraction (150.2345, not 150) in Accounting → Currencies.
- [ ] 7.2 Rates carry up to 5 decimals for all currencies, regardless of each currency's own decimalPlaces.
- [ ] 7.3 A currency whose rate is below 0.5 against a 0-decimal setting (previously frozen at 0 by the truthiness filter) now receives a real rate on the nightly run.

## 8. Unit prices (Price kind)

- [ ] 8.1 Supplier part at unit price **0.164**: survives blur/save; displays **$0.164** in the form, price-break rows, and supplier-parts table.
- [ ] 8.2 Storage round-trip: hard-refresh and reopen — the value is 0.164 (the column holds the scale after 15b, not just the UI).
- [ ] 8.3 Unit price 4.5 displays padded: **$4.50**.
- [ ] 8.4 Extended price: 10,000 × $0.164 = **$1,640.00** (settlement-rounded, not $1,600 from a pre-rounded $0.16).
- [ ] 8.5 Purchase history / quote line price displays show full stored precision (up to 5 decimals) — and purchase history renders in the account locale (the hardcoded en-US is gone).
- [ ] 8.6 Customer portal (share link) sales-order lines: prices NOT truncated to 2 decimals (portal function return-type fix).

## 9. Payments, memos & settlement (5dp GL, settlement decimals)

### Orientation — where these live

Two separate screens, both under **Invoicing** in the left sidebar, in the
**Payments** group at the bottom of that menu:

| Screen | Sidebar item | URL |
|---|---|---|
| Payments (cash in/out) | **Payments** | `/x/invoicing/payments` |
| Credit & debit memos (non-cash adjustments) | **Credits & Debits** | `/x/invoicing/credits` |

Both follow the same lifecycle: **Draft → Posted → Voided.** A document only
writes GL entries when you press **Post**. While it is Draft you can edit it;
once Posted it is immutable and the header's primary button changes from
**Post** to a red **Void**.

Two vocabulary points that decide which fields you get:

- **Payment Type** — `Receipt` means money coming IN, so the form asks for a
  **Customer**. `Disbursement` means money going OUT, so it asks for a
  **Supplier**. Picking the wrong one and then hunting for the missing field is
  the usual first stumble.
- **Memo Direction** — party × direction gives four combinations:
  Customer + Credit → AR down · Customer + Debit → AR up ·
  Supplier + Debit → AP down · Supplier + Credit → AP up.
  For 9.3 you want **Customer + Credit** (the customer owes you less).

### Setup — you need an open invoice to pay first

A payment with nothing to apply to proves nothing, so build the target first.

1. Go to **Invoicing → Sales Invoices**, press **New**.
2. Pick your customer. Set **Currency** to **EUR** (any currency that is not
   your base USD) — this is what makes 9.1 a foreign-currency test.
3. Set **Exchange Rate** to `1.25`.
4. Add a line: quantity `10`, unit price `100.00`. Save.
5. Press **Post** in the header. The invoice must reach **Posted** with an open
   balance — if it is still Draft, the payment screen will not offer it.
6. Repeat 1–5 for a **second** EUR invoice (quantity `4`, unit price `50.00`)
   so 9.1 has two invoices to split across.

Note the two balances shown on the invoice list; you will reconcile against
them at the end.

### 9.1 Foreign-currency payment across two invoices

- [ ] 9.1 **Invoicing → Payments → New.** Fill in, top to bottom:
  - **Payment ID** — leave it; the sequence fills it in.
  - **Type** — `Receipt`. (A **Customer** field appears once you pick this.)
  - **Customer** — the customer from setup.
  - **Payment Date** — today.
  - **Currency** — `EUR`.
  - **Exchange Rate** — `1.25`.
  - **Total Amount** — `900.00` (less than the 1200 + 200 = 1400 open, so the
    applications are deliberately partial).
  - **Bank / Cash Account** — pick any Asset account.
  - **Reference** — `PRECISION-9.1`.

  Save. You land on the payment detail page in **Draft**.

  On that page, find the **Apply to invoices** panel. Both EUR invoices are
  listed with their open balances. Type an applied amount against each —
  `700.00` on the first, `200.00` on the second (900 total, matching the
  payment). Then press **Post** in the header.

  **Expected:** it posts. **No "journal does not balance" error.** This is the
  case that broke when the JS balance check ran at 5dp while the column still
  rounded to 4 — if you see that error, stop and record the exact message.

- [ ] 9.2 On the same screen before posting (use a fresh Draft payment if 9.1 is
  already Posted), press **Auto apply**. It should fill the rows top-down until
  the payment is exhausted, and the unapplied remainder should read exactly
  `0.00` — not `0.00001` or `-0.00`. Clear it and re-apply to confirm it
  round-trips.

- [ ] 9.3 **Invoicing → Credits & Debits → New.**
  - **Memo ID** — leave it.
  - **Direction** — `Credit`.
  - **Customer** — same customer.
  - **Memo Date** — today.
  - **Currency** — `EUR`, **Exchange Rate** `1.25`.
  - **Amount** — `150.00`.
  - **Reference** — `PRECISION-9.3`.

  Save, then **Post**. **Expected:** posts cleanly; the GL entries balance.
  To see them: **Accounting → Journal Entries**, find the newest entry, and
  confirm total debits equal total credits.

- [ ] 9.4 Repeat 9.1 with a **USD** payment at **Exchange Rate `1.0`** against a
  USD invoice. **Expected:** identical behaviour to before this branch — this is
  the no-FX control case.

- [ ] 9.5 **The settlement-vs-internal distinction — the point of the suite.**
  After the 9.1 payment posts, open each invoice it touched and read the
  **balance / amount due**. **Expected:** a clean settlement figure at the
  currency's decimals — `€500.00`, never `€500.00000` or `€499.99998`.
  Then open the GL entry behind it (**Accounting → Journal Entries** → the
  entry for that payment). **Expected:** the internal journal lines there
  *may* carry up to 5 decimals. That asymmetry is correct and deliberate:
  settlement values round to the currency, internal GL lines carry scale 5.
  A 5-decimal figure on the *invoice balance* is the bug; a 5-decimal figure on
  a *journal line* is not.

- [ ] 9.6 **Dust forgiveness.** Create a payment for `0.995` less than an
  invoice's full open balance (e.g. balance `€500.00`, pay `€499.01`), apply it
  all to that invoice, and post. **Expected:** the invoice flips to **Paid**
  anyway — that is `INVOICE_DUST_THRESHOLD` (a penny or two of difference is
  forgiven when deciding paid status, an existing Carbon concept, not something
  this branch introduced). Also confirm no spurious on-account credit line was
  created for sub-`0.0001` unapplied dust.

- [ ] 9.7 **Period close.** Go to **Accounting → Periods**, find the period
  containing today's postings, and close it. **Expected:** the close audit
  passes with no debit/credit drift flagged. The close check uses a `0.001`
  tolerance (manual journals and period close), deliberately tighter than the
  `0.01` used by payment/memo posting — do not "fix" one to match the other.

**If a post fails:** capture the full error text and the payment/memo ID before
retrying. "Journal does not balance (off by …)" with a drift smaller than
`0.01` is the specific regression this suite exists to catch.

## 10. Tax value pair propagation (any write that sets one sets both)

- [ ] 10.1 Duplicate a PO whose line has 6.25% / $0.56: the duplicate's line shows **6.25% AND $0.56** (not 0% + $0.56).
- [ ] 10.2 Convert a supplier quote (with a taxed price break) to a PO: the PO line carries the break's percent and amount.
- [ ] 10.3 Create a purchase invoice from a partially-received PO with tax: the invoice line's percent equals the PO line's percent; the amount is prorated by the uninvoiced fraction.
- [ ] 10.4 Edit the invoice line's quantity afterwards: the amount re-derives from the carried percent (NOT from 0% — the pre-fix failure mode zeroed it).
- [ ] 10.5 AI-extracted supplier invoice (upload a PDF with tax): the created line's percent = extracted tax / subtotal; reopening and editing the base re-derives sensibly.
- [ ] 10.6 Supplier portal: submit a digital quote with a tax amount on a break — the stored row carries a derived percent, and converting it to a PO carries both.

## 11. Percent displays & inputs app-wide

- [ ] 11.1 Percents render up to 3 digits, only when real: 5% → "5%", 6.25% → "6.25%", 6.255% → "6.255%".
- [ ] 11.2 Quote line discount: 12.345% survives blur and save (no 2-digit clamp).
- [ ] 11.3 Read-only percent cells in tables render without regression (spot-check quotes list, tax columns).

## 12. Quantity displays

- [ ] 12.1 Read-only quantity cells show full stored precision up to 5 decimals: 4.33333 → "4.33333"; whole numbers stay whole ("3"); 0.00125 renders "0.00125" (old "<0.01" placeholder is gone).
- [ ] 12.2 Editable quantity inputs preserve 5 decimals (4.33333 survives blur/save).
- [ ] 12.3 MES: the 4.5-unit job's operation shows 4.5; serial/tracked-entity counts remain whole numbers.
- [ ] 12.4 Dense tables (BOM, job materials, inventory) remain readable — common-case values render exactly as before; only genuinely-precise values show more digits.

## 13. Locale formatting (hardcode fixes)

Switch account language to German (or browser locale de-DE):

- [ ] 13.1 Intercompany transaction table + balance matrix: locale separators (1.234,56), not US format.
- [ ] 13.2 Quote line pricing history: same.
- [ ] 13.3 Supplier part purchase history: same (was hardcoded en-US).
- [ ] 13.4 Maintenance dispatch items: costs render as formatted currency (no literal `$` on a raw number). MES work-center maintenance display uses the app locale, not the browser default.
- [ ] 13.5 Spot-check 3–4 money-heavy screens (invoices list, quote summary, payment tables) in de-DE — no mixed-locale artifacts.

## 14. PDFs

Generate a quote, a sales order, and a sales invoice PDF, each with a taxed line at 6.255%:

- [ ] 14.1 Tax percent prints **6.255%** (not "6.26%").
- [ ] 14.2 A 6.25% line prints "6.25%" (no forced third digit).
- [ ] 14.3 Amounts/totals unchanged vs a pre-change control PDF of the same document.

## 15. Xero boundary (engineer-run; needs a connected sandbox or unit tests)

- [ ] 15.1 Payload builders round at serialization: totals/payments/balance at the currency's decimals; UnitAmount at 4dp. Verify via the EE unit tests if present, else inspect a captured payload.
- [ ] 15.2 LineAmount no longer carries float garbage (0.45000000000000007-class values) — pre-existing bug fixed by the boundary rule.

## 16. Conformance & regression gates (engineer-run)

- [ ] 16.1 `pnpm --filter @carbon/utils test` — precision + format suites green (incl. the assertBalanced tolerance pins).
- [ ] 16.2 `pnpm --filter @carbon/checks test` — all three new checks green; `newViolations()` = 0 against the fresh baseline.
- [ ] 16.3 `pnpm run lint` + the scoped typechecks in the plan's Final validation — green.
- [ ] 16.4 `grep -rn "round4" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules` → no output.
- [ ] 16.5 `grep -rn "SUPPLIER_PART_PRICE_PRECISION" apps --include="*.ts" --include="*.tsx"` → no output (the constant never landed; the price kind covers those sites).
- [ ] 16.6 Smoke: load each core ERP module (sales, purchasing, invoicing, production, inventory, accounting, quality) — no console errors.

## Known gaps as of 2026-08-12 (expected-fail, already tracked)

Distinct from the by-design list below: these are things the branch intends to
do and does not do yet. Mark them expected-fail; don't file them.

- **Currency decimals outside tax fields** — see the banner on suite 6. Affects
  6.1 and 6.4, and any unit-price display in suites 8 and 11 on a non-2-decimal
  currency. Three commits attempting this were reverted on 2026-08-12 for
  hardcoding `?? 2` against the plan's own rule; the fix needs `decimalPlaces`
  exposed client-side first (plan → Open items 1).
- **`SupplierQuoteLinePricing` is not on `TaxFields`** — suite 4 exercises a
  hand-rolled percent/amount pair there, so its two-way coupling behaviour may
  differ from the other three forms (plan → Open items 3).
- **Exchange Rate input caps at 4 decimals** (`PaymentForm`), while exchange
  rates are scale-5 internal values. Typing a 5-decimal rate truncates on blur.
  Relevant to suite 7 and to the 9.x setup steps (plan → Open items 5).
- **10 unclassified `Math.round` sites in MES** — suite 12 may show rounded
  quantities on those screens (plan → Open items 4).

## Known-acceptable outcomes (do not file as bugs)

- Historical purchasing lines keep their previously-derived (drifted) rates — a stored 6.22% stays 6.22%; the original entry is unrecoverable by design (no backfill).
- Jobs created before the fix keep integer estimated quantities until their recalculate re-runs.
- GL journal lines now carry 5 decimals where they carried 4 (intentional; requires migration 15a). Settlement values (balances, applied amounts) stay at currency decimals by design.
- A manual tax-amount override is replaced by the derived amount when the line's base (qty/price/shipping) changes afterward.
- Quantity cells may show more decimals than before when the stored value genuinely has them (truthful display, not a formatting bug).
- CSV table exports contain raw stored values, so they may now show 5 decimals where the old columns clamped earlier — truthful data, expect diff churn against old exports.
- The first nightly FX run after deploy updates currencies that were previously frozen at a zero rate, and 0-decimal currencies' rates become fractional for the first time.
- Xero syncs now include an explicit CurrencyRate for near-1 rates that previously snapshotted to exactly 1 and were omitted.
