# Exchange Rate Overrides (platform-global rates + per-company overrides)

Last tested: 2026-09-02
Route: /x/accounting/exchange-rates (+ /$currencyId drawer)

## Background (currency-exchange-rate-refactor)
- Rates are platform-global, USD-anchored, seeded (118 rows in `exchangeRate`), on by default — no integration.
- The `currency.exchangeRate` column and `exchangeRateHistory` table are dropped; `exchange-rates-v1` integration is gone.
- Resolver `get_exchange_rate(companyId, code)`: base → 1, override → override rate, else market ratio r(code)/r(base); errors if unresolvable (never falls back to 1).
- Per-company `exchangeRateOverride` rows always beat the market feed; delete = back to market.

## Prerequisites
- Company base currency seeded (Carbon Development = USD).

## Steps
### 1. List — /x/accounting/exchange-rates
- Columns: Name, Code, Exchange Rate, **Source**, Actions.
- Base currency (USD) row: rate `1`, source badge "BASE CURRENCY".
- Foreign currencies: resolved rate + "MARKET RATE" badge (e.g. EUR 0.92, GBP 0.79, CAD 1.36).

### 2. Create an override
- Open a foreign currency's drawer (click the row link, or navigate to /$currencyId).
- Drawer shows: Exchange Rate field ("One {base} is equal to how many {code}?"), source badge, "Save Rate" button, and "Market Rate History (per USD)" chart.
- Fill the Exchange Rate field, **blur** (click the Name field to commit the react-aria value), then click **"Save Rate"**.
- Result: redirect to list; the row shows the new rate with a **"YOUR RATE"** badge; a row appears in `exchangeRateOverride` (createdBy = current user); resolver returns the override.

### 3. Reset to market rate
- Re-open the drawer (the "Reset to market rate" button only renders when an override exists).
- Click **"Reset to market rate"** → override row deleted; badge returns to "MARKET RATE"; resolver returns the market ratio again.

### 4. Positivity guard
- Setting the rate to 0 (or negative) and clicking "Save Rate" fails with "Rate must be positive" (zod), no override written. DB also has CHECK (rate > 0).

### 5. Document stamping (core behavior)
- New quote in base currency (USD) stamps `quote.exchangeRate = 1`.
- Changing a quote's currency to a foreign code re-stamps the header via the resolver: EUR → 0.92 (market), or the override rate if one exists — never 1.

## Selector Notes
- Rate field is a react-aria number input (empty `name`; value committed on blur). `agent-browser fill` + click-away usually commits it; if flaky, focus via DOM and type. Verify the visible value updated BEFORE clicking Save Rate.
- Drawer refs shift when the "Reset to market rate" button is present (override exists) — re-snapshot to get fresh refs.
- Currency combobox on quote detail: click to open, then type into the "Search..." input to filter (options are virtualized; they don't all render up front). Select the filtered option.

## Common Failures
- Saving without blurring the rate field commits the OLD displayed value (looks like a no-op override at the market rate). Always confirm the visible value changed first.
- Seeding a `Stock Only`-style non-effect: base currency always resolves to 1 and shows "BASE CURRENCY" — pick a FOREIGN currency to see override behavior.
