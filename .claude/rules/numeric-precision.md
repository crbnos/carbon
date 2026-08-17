paths:
  - "packages/database/supabase/functions/shared/precision.ts"
  - "packages/utils/src/math.ts"
  - "packages/utils/src/format.ts"
  - "packages/checks/src/conformance/no-derived-percent-column.ts"
  - "packages/checks/src/conformance/no-raw-rounding.ts"
  - "packages/checks/src/conformance/no-inline-fraction-digits.ts"
  - "packages/checks/src/sources/typescript.ts"
  - "packages/form/src/components/Number.tsx"
  - "packages/ee/src/accounting/providers/xero/serialize.ts"
  - "apps/erp/app/components/Form/TaxFields.tsx"
  - "apps/erp/app/hooks/useCurrencies.ts"

# Numeric Precision & Formatting

The numeric standard for every price, rate, quantity, and amount in Carbon.
Source of truth: `packages/database/supabase/functions/shared/precision.ts`
(Deno-side because the edge runtime only mounts `supabase/functions/`;
`packages/utils/src/math.ts` re-exports it for Node/browser — that relative
import is BY DESIGN, not an import to "fix").

## Two storage scales

| Class | Scale | Examples |
|---|---|---|
| Internal values | `SCALE = 5` | per-unit prices, rates (0–1 fractions), quantities, GL journal lines, exchange rates |
| Settlement values | `currency.decimalPlaces` (DB column — authoritative over Intl/CLDR) | invoice balance/amountDue, applied payment amounts, document totals, tax amounts |

Settlement values are rounded to the currency's decimals at the boundary that
produces them — the applied amounts a user enters, and every amount serialized
to an external system. The columns themselves are bare NUMERIC and an invoice
`balance` is read from a view rather than written by `post-payment`, so storage
does not enforce this; the rounding does. Only internal GL journal lines carry
scale 5. Invoice paid-status dust forgiveness (`INVOICE_DUST_THRESHOLD = 0.01`,
`invoicing.models.ts`) and post-payment's `0.0001` unapplied-dust band are
deliberate business behavior layered on top.

## Three-boundary rule

Round only at **persist**, **display**, and **compare**. Intermediates stay at
full float precision; Postgres computes derived values (generated columns);
`sum()` accumulates first and rounds once.

## The API (flat, no namespaces)

- `round(value, scale = SCALE, mode = HalfUp)` — exponent-shift rounding
  (`round(1.005, 2) === 1.01`), ties away from zero to match Postgres.
- `scrapAllowance(target, rate)` — the extra WHOLE units to cover scrap; the
  fractional target itself is never rounded, and callers add the two
  (`4.5 + scrapAllowance(4.5, 0) === 4.5`; `31 + scrapAllowance(31, 0.01) === 32`).
- `applyRate(base, rate, decimals)` — tax/discount → settlement amount;
  `decimals` comes from `currency.decimalPlaces` — data, never a literal.
- `deriveRate(amount, subtotal)` — the inverse of `applyRate`: recover the rate
  an absolute amount implies, rounded to internal scale. The ONE place a rate is
  derived from an amount; a bare `amount / subtotal` at a call site is a bug.
- `equals(a, b)` / `EPSILON = 1e-6` — the one float-noise tolerance.
- `assertBalanced(debits, credits, tolerance = EPSILON, label = "Journal")` —
  ledger invariant. Pass a `label` so the refusal names the journal and its
  currency (`"Payment journal (base currency)"`).
  `tolerance` is a BUSINESS refusal threshold: payment/memo posting passes
  `0.01`, manual journals and period close use `0.001`. Do not unify them and
  do not tighten to EPSILON — FX journals carry genuine sub-cent residuals.

**No scale literals**: a numeric literal as the `scale` argument outside
`precision.ts` is a violation — internal values use the default, settlement
passes `currency.decimalPlaces`. (Whole-unit ceils use `round(x, 0, Up)`;
external boundaries like Xero use the adapter's named contract constants in
`packages/ee/src/accounting/providers/xero/serialize.ts`.)

## Percentages are stored facts

`taxPercent` and its amount are ONE VALUE PAIR — one relative, one absolute.
**Any write that sets one must set both**: copy the percent when the source
row has one (duplicate, convert); derive it once (`amount / subtotal`, the
canonical denominator `unitPrice × qty + shippingCost`) when only an amount
exists (AI extraction, supplier portal). Never a GENERATED column that divides
(`no-derived-percent-column`) — the old derived echo turned a typed 6.25% into
6.22% via the cents-rounded amount.

In the UI the pair is coupled BOTH ways (`TaxFields`), so what is stored is
always internally consistent: a percent edit derives the amount via
`applyRate` at `currency.decimalPlaces`; an amount edit derives the rate via
`round(amount / subtotal)` at internal scale; a base change (qty, price,
shipping) re-derives the amount from the rate. Precision only flows cleanly
one way — a rate carries more decimals than a settlement amount, so a rate
derived back from an amount is limited by that amount's scale (0.56 on a 9.00
subtotal is 6.222%, not 6.25%). That is inherent, and distinct from the old
corruption, which came from deriving the amount UNROUNDED so the money input
re-committed a changed value on blur. Derive the amount through `applyRate`
and blur commits an identical value, triggering nothing.

`useDerivedTaxAmount` (exported from `TaxFields`) owns the base-change
re-derivation and deliberately skips its first run — a saved line's stored
pair is displayed as stored rather than silently recomputed on mount.

Build the denominator with `taxableBase(unitPrice, quantity, shippingCost)`
(also from `TaxFields`), never inline arithmetic. An EMPTIED number input
commits **NaN**, not 0 — that is react-aria's empty state
(`if (!newInputValue.length) setNumberValue(NaN)`) — and one NaN term makes
the whole sum NaN, so `applyRate` returns NaN, the amount field renders blank,
and saving writes 0 against a live 6.25% percent. The pair is broken and the
tax silently vanishes. `taxableBase` reads each term as 0 BEFORE the sum, which
is the only place it can be done: once the terms are added, no downstream guard
can recover them. `useDerivedTaxAmount` additionally refuses a non-finite
subtotal, so "never overwrite a stored amount with NaN" holds by construction.

## Display digits = input digits (named kinds)

`packages/utils/src/format.ts` defines the ONLY digit choices (`PERCENT_DIGITS`
is module-private so the two percent kinds can never drift apart):

| Kind | Digits | Notes |
|---|---|---|
| Percent / rate | min 0, max 3 | "5%", "6.25%", "6.255%" |
| Percent points | min 0, max 3 | the same rate typed bare in a field already labelled "%" — `6.25`, caller divides by 100 |
| Exchange rate | min 0, max 5 | "1.0852", "0.00781" — a plain multiplier, not a percent and not a currency. Intl's decimal default caps at 3, which truncates a stored rate on blur |
| Quantity | min 0, max 5 | "3", "4.33333", "0.00125" — no "<0.01" placeholder |
| Money (settlement) | max = min = `currency.decimalPlaces` | "$300.00", "$3.50", "$0.00", "¥63", "BHD 0.563" — what someone PAYS: an invoice total, line amount, payment, tax amount. A currency cannot settle a fraction of its smallest unit, so its decimals are both floor and CEILING; a stored 300.33323 displays "$300.33" and storage keeps the rest. PADDED, because fixed-width money is the accounting convention |
| Rate (per-unit price/cost) | min = `currency.decimalPlaces`, max = `SCALE` | "$300.00", "$3.50" — pads exactly like money, so a price column stays aligned — but the currency's decimals are only its FLOOR. Above them it carries the storage scale: "$0.164", "$0.00123", "$12.34567". A price is what you MULTIPLY BY, not what you settle, and a 2-decimal ceiling silently turned a real $0.00123 fastener price into $0.00 ([#1203](https://github.com/crbnos/carbon/issues/1203)). Every ERP splits these — Xero settles at 2 and takes 4 on `UnitAmount` (opt-in `unitdp=4`), QuickBooks Desktop shows 5 in the Rate column, SAP reaches sub-cent prices with a price unit (per 100/1000) — and none of them widens settlement values. `INPUT_STEP.rate` is the scale step, since `money`'s cent step would snap away exactly the digits this keeps |
| ↳ trailing-zero preference | min 0 when set | `companySettings.showCurrencyTrailingZeros` (default true) turned OFF drops the non-significant zeros — "$300", "$3.5". DISPLAY and IN-APP only, and it covers EDITABLE fields too: `useCurrencyFormatter` and `MotionMoney` read it once via `useCurrencyMinDecimals`, and `~/components/Form`'s `Number`/`NumberControlled` wrappers (`CurrencyNumber.tsx`) apply it to any `style: "currency"` `formatOptions` — never a call site, which is why the ~80 `INPUT_FORMAT.money/price(...)` calls still pass two arguments. Overriding the MINIMUM is safe on an input even though `formatOptions` is part of the storage round-trip: react-aria commits `parse(format(x))` and only the MAXIMUM can change that. Documents render through the pure `formatMoney` and stay padded — a customer-facing invoice is where fixed-width money matters most. A PUBLIC page is not automatically settings-free: `useCompanySettings` reads `useRouteData(authenticatedRoot)`, which matches on the PATHNAME `/x` and so returns nothing under `/share/**`, so the quote share page passes its own service-role `companySettings` down through `CompanySettingsProvider` (`useCompanySettings.tsx`). Any other public route that wants the preference must do the same — the fallback is silent, and reads as "padded on purpose" rather than "never wired up" |
| Editable currency (`INPUT_FORMAT.money` / `.rate`) | same as its kind above | an input formats with the SAME digits it displays with, padding included — an empty cost reads "$0.00". react-aria's blur commit is literally `setNumberValue(parse(format(x)))`, so this is not decoration — it is what a typed amount is STORED at. `.money` commits 300.22121 as 300.22 in USD and 63.4 as 63 in JPY; `.rate` commits 0.00123 as 0.00123, which is the whole point of the rate kind |

Call sites pick a kind (`formatMoney/Price/Percent/Quantity`, the
`useCurrencyFormatter` (with `rate`/`compact`/`wholeUnits` naming the
kind)/`usePercentFormatter`/
`useQuantityFormatter` hooks — the first two are the same function) — never `minimumFractionDigits`/
`maximumFractionDigits` inline (`no-inline-fraction-digits`), and module-local
`*_PRECISION` constants are the same violation. **Editable inputs MUST use
`INPUT_FORMAT.*`**: react-aria's blur commit runs `parse(format(x))`, so the
input formatter is part of arithmetic. (`packages/react/src/Number.tsx`
stabilizes `formatOptions` by value, so inline `INPUT_FORMAT.money(c, d)`
calls are safe.)

**A `step` is arithmetic too** — react-aria SNAPS the committed value to the
nearest multiple of it, so a step coarser than the field's scale silently
truncates what the formatter would otherwise display: `step={0.0001}` on a
rate turned a typed 6.255% into 6.25%, and 12.345% into 12.34%. Take the step
from `INPUT_STEP.*` (paired with the kinds above — `rate`/`quantity`/
`exchangeRate` at 1e-5, `money(decimalPlaces)` at the currency's own unit for
money AND prices) or omit the prop. There is deliberately no finer price step:
since the commit rounds through the format, a step below the field's own format
can only produce values the formatter discards.
A step literal at a call site is a violation for the same reason a digit
literal is.

## Raw rounding is banned

`Math.round/ceil/floor` and `.toFixed` on value-bearing numbers fail the
`no-raw-rounding` check — use the API above. Genuinely-integer sites (serial
counts, pagination, lead-time buckets, AQL ladders, geometry) live in the
`@carbon/checks` baseline, not in exemption lists.

## Runtime NUMERIC decoding

Both Postgres drivers decode NUMERIC (OID 1700) to JS numbers so runtime
matches the generated types: node-postgres via `setTypeParser`, deno-postgres
(v0.19.x, aliased `"pg"` in `functions/deno.json`) via `controls.decoders` —
both registered in `functions/lib/postgres/index.ts`. Existing `Number(...)`
coercions are harmless no-ops; float8 columns still arrive as strings.

## Conformance

Three checks in `@carbon/checks` guard the standard: `no-derived-percent-column`
(SQL migrations), `no-raw-rounding` and `no-inline-fraction-digits` (all app TS
via `sources/typescript.ts`). That source also covers the shared packages —
`packages/{utils,form,react,printing,workflows}/src` — because the standard's own
helpers live in `@carbon/utils` and `form`/`react` own the number inputs whose
`formatOptions` are part of the storage round-trip. A bare `Number` field with no
`formatOptions` defaults to the quantity kind (`packages/form/src/components/Number.tsx`).

Fix new hits — baseline only NOT-IN-CLASS sites (calendar buckets, relative-time
math, file sizes, label/pixel geometry, pagination). Note `no-numeric-precision`
reads migration TEXT, so a column a widening migration SKIPPED produces no
finding: the check cannot tell you the live schema is still clamped.
