# Currency & Exchange Rate Architecture Refactor — implementation plan

**Spec:** .ai/specs/2026-09-02-currency-exchange-rate-refactor.md
**Research:** .ai/research/exchange-rate-competitor-practice.md · .ai/research/2026-09-02-currency-architecture.md (the blast-radius map — consult it for every call-site list) · .ai/research/2026-09-02-exchange-rate-update-path.md
**Branch:** hat-yai

Conventions that bind every task: migrations idempotent (guards on every DDL); never
backdate timestamps; `pnpm`, never `npm`; scoped typechecks only (whole-repo OOMs); rate
meaning at stamping sites is UNCHANGED ("document-currency units per 1 base unit").

## Progress
- [x] Task 1: Author migration M1 — global store, overrides, resolver functions
- [x] Task 2: Author migration M2 — data migration, column drop, view, integration delete
- [x] Task 3: Author migration M3 — salesInvoice propagation, CHECKs, consolidation forks
- [x] Task 4: Apply migrations, regenerate types, psql assertions
- [x] Task 5: Models + service layer (accounting module)
- [x] Task 6: Sweep sales.service.ts stamping sites
- [x] Task 7: Sweep purchasing.service.ts stamping sites
- [x] Task 8: Sweep invoicing.service.ts + all six exchange-rate refresh routes
- [x] Task 9: Edge functions `convert` + `create` → resolver
- [x] Task 10: Jobs — rewrite feed job, kill paperless-parts duplicate
- [x] Task 11: Delete the exchange-rates integration from @carbon/ee
- [x] Task 12: Seed paths + backup scoping pins
- [x] Task 13: UI — exchange-rates page: resolved rates, provenance, overrides
- [x] Task 14: Full scoped validation (typecheck erp/jobs/ee/database + lint + tests)
- [x] Task 15: Dataset + backup pre-commit gates
- [ ] Task 16: Browser verification (/test)
- [ ] Task 17: Docs sync (carbon-docs)

## Dependencies
- Tasks 1–3 are independent authoring tasks (order irrelevant; MUST all exist before Task 4).
- Task 4 needs 1–3. Everything after needs Task 4 (generated types).
- Tasks 6, 7, 8, 9, 10, 11, 12 are mutually independent (different files) — parallelizable after Task 5.
- Task 13 needs Task 5. Task 14 needs 5–13. Tasks 15–17 need 14.

---

## Task 1: Author migration M1 — global store, overrides, resolver functions

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_exchange-rate-global-store.sql` (via `pnpm db:migrate:new exchange-rate-global-store`; HHMMSS must not be 000000)

**Steps:**
1. `pnpm db:migrate:new exchange-rate-global-store`
2. Write, in order:

```sql
-- Global market-rate store. Deliberately NOT tenant-scoped: market data, same class
-- as "currencyCode". rate = units of "currencyCode" per 1 USD.
CREATE TABLE IF NOT EXISTS "exchangeRate" (
    "id" TEXT NOT NULL DEFAULT id('xrate'),
    "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code") ON DELETE CASCADE ON UPDATE CASCADE,
    "effectiveDate" DATE NOT NULL,
    "rate" NUMERIC NOT NULL CHECK ("rate" > 0),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "exchangeRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exchangeRate_code_date_key" UNIQUE ("currencyCode", "effectiveDate")
);
CREATE INDEX IF NOT EXISTS "exchangeRate_code_date_idx" ON "exchangeRate" ("currencyCode", "effectiveDate" DESC);
ALTER TABLE "exchangeRate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."exchangeRate";
CREATE POLICY "SELECT" ON "public"."exchangeRate" FOR SELECT TO authenticated USING (true);
-- writes: service role only (no INSERT/UPDATE/DELETE policies)
```

   Note the bare `NUMERIC` (house rule: no precision spec).
3. `exchangeRateOverride` per the spec's SQL sketch, EXCEPT: bare `NUMERIC`, inline FK
   refs for `createdBy`/`updatedBy` to `"user"("id")`, indexes on `companyId`,
   `currencyCode`, `createdBy`; RLS policies named `SELECT`/`INSERT`/`UPDATE`/`DELETE`
   schema-qualified with `::text[]` casts:
   - SELECT: `"companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])`
   - INSERT/UPDATE/DELETE: `get_companies_with_employee_permission('accounting_update')`
     for all three write verbs (mirror how a recent accounting-scoped table does it —
     fork the policy shape from the NEWEST migration containing
     `get_companies_with_employee_permission('accounting_`).
4. Seed the global store — one row per code from Appendix A, `effectiveDate` =
   `'2026-09-01'`, `ON CONFLICT ("currencyCode","effectiveDate") DO NOTHING`, comment:
   `-- Bootstrap snapshot (approximate, 2026-09). Superseded by the daily feed job.`
   Cross-check: every `code` in the `currencies` array of
   `packages/database/supabase/functions/lib/seed.data.ts` (~line 484) must appear in
   Appendix A. If any code is missing from the appendix, STOP and report — do not invent
   a rate inline.
5. Resolver functions (PLPGSQL — never LANGUAGE sql for anything whose ordering/inlining
   matters):

```sql
CREATE OR REPLACE FUNCTION get_exchange_rate(
  p_company_id TEXT,
  p_currency_code TEXT,
  p_as_of DATE DEFAULT NULL
) RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base TEXT;
  v_override NUMERIC;
  v_code_rate NUMERIC;
  v_base_rate NUMERIC;
  v_as_of DATE := COALESCE(p_as_of, CURRENT_DATE);
BEGIN
  SELECT "baseCurrencyCode" INTO v_base FROM "company" WHERE "id" = p_company_id;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Company % not found', p_company_id;
  END IF;
  IF p_currency_code = v_base THEN RETURN 1; END IF;

  SELECT "rate" INTO v_override FROM "exchangeRateOverride"
   WHERE "companyId" = p_company_id AND "currencyCode" = p_currency_code;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  SELECT "rate" INTO v_code_rate FROM "exchangeRate"
   WHERE "currencyCode" = p_currency_code AND "effectiveDate" <= v_as_of
   ORDER BY "effectiveDate" DESC LIMIT 1;
  SELECT "rate" INTO v_base_rate FROM "exchangeRate"
   WHERE "currencyCode" = v_base AND "effectiveDate" <= v_as_of
   ORDER BY "effectiveDate" DESC LIMIT 1;
  IF v_code_rate IS NULL OR v_base_rate IS NULL THEN
    RAISE EXCEPTION 'No exchange rate available for % (base %). Set a rate manually in Accounting -> Exchange Rates.',
      p_currency_code, v_base;
  END IF;
  RETURN v_code_rate / v_base_rate;
END;
$$;
```

   And `get_exchange_rates(p_company_id TEXT) RETURNS TABLE("currencyCode" TEXT,
   "decimalPlaces" INTEGER, "active" BOOLEAN, "rate" NUMERIC, "source" TEXT,
   "rateUpdatedAt" TIMESTAMPTZ)` — joins the company's group `currency` config rows
   (resolve `companyGroupId` from `company`) to overrides (source `'override'`,
   `rateUpdatedAt` = override's `COALESCE(updatedAt, createdAt)`) else the latest global
   pair ratio (source `'market'`, `rateUpdatedAt` = the global row's
   `COALESCE(updatedAt, createdAt)`), with the company's base row returning
   `rate = 1, source = 'base'`. A code with no resolution returns `rate NULL, source
   'missing'` (the LIST function reports rather than raises; only the scalar raises).
   Grant EXECUTE on both to `authenticated`.

**Verify:**
```bash
ls packages/database/supabase/migrations/ | tail -3
# Expected: <new-timestamp>_exchange-rate-global-store.sql listed, timestamp newer than every existing file
grep -c "ON CONFLICT" packages/database/supabase/migrations/*exchange-rate-global-store.sql
# Expected: >= 1 (seed idempotency)
```

**Out of scope:** anything touching the `currency` table (Task 2), consolidation (Task 3).

## Task 2: Author migration M2 — data migration, column drop, view, integration delete

**Depends on:** none (authoring); ordering with M1 is by timestamp — create AFTER Task 1's file so this timestamp sorts later. If created earlier, STOP and re-create.
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_currency-config-only.sql` (via `pnpm db:migrate:new currency-config-only`)
- Modify: `packages/jobs/src/backups/renames.ts` — add `"exchangeRateHistory": null` to `TABLE_RENAMES`

**Steps:**
1. Migrate hand-set rates to overrides (run BEFORE the column drop, same file):

```sql
INSERT INTO "exchangeRateOverride" ("companyId", "currencyCode", "rate", "createdBy")
SELECT co."id", cu."code", cu."exchangeRate", 'system'
FROM "currency" cu
JOIN "company" co ON co."companyGroupId" = cu."companyGroupId"
WHERE cu."exchangeRate" <> 1
  AND cu."code" <> co."baseCurrencyCode"
  AND NOT EXISTS (
    SELECT 1 FROM "companyIntegration" ci
    WHERE ci."id" = 'exchange-rates-v1' AND ci."active" = true
      AND ci."companyId" IN (
        SELECT c2."id" FROM "company" c2 WHERE c2."companyGroupId" = cu."companyGroupId"
      )
  )
ON CONFLICT ("companyId", "currencyCode") DO NOTHING;
```

2. Recreate the `currencies` view WITHOUT `exchangeRate`: find the NEWEST definition
   (`grep -rn "CREATE OR REPLACE VIEW \"currencies\"\|CREATE VIEW \"currencies\"" packages/database/supabase/migrations/ | tail -1`,
   expected `20260228023426_company-groups.sql:924-928`), fork it, `DROP VIEW IF EXISTS
   "currencies";` then recreate `WITH(SECURITY_INVOKER=true)` selecting the surviving
   columns + `currencyCode.name`. If the newest definition selects columns other than
   what the research doc §1.2 lists, STOP and report.
3. `ALTER TABLE "currency" DROP COLUMN IF EXISTS "exchangeRate";`
   (`historicalExchangeRate`, `decimalPlaces`, `active`, `tags`, `customFields` remain.)
4. `DROP TABLE IF EXISTS "exchangeRateHistory";` — zero writers/rows (research §3.1).
5. `DELETE FROM "companyIntegration" WHERE "id" = 'exchange-rates-v1';`
6. Add the `TABLE_RENAMES` entry (`"exchangeRateHistory": null`) in
   `packages/jobs/src/backups/renames.ts` — same commit as this migration.

**Verify:**
```bash
grep -n "DROP COLUMN IF EXISTS\|DROP TABLE IF EXISTS\|ON CONFLICT" packages/database/supabase/migrations/*currency-config-only.sql
# Expected: all three present
grep -n "exchangeRateHistory" packages/jobs/src/backups/renames.ts
# Expected: "exchangeRateHistory": null
```

**Out of scope:** `historicalExchangeRate` (stays), `currency` RLS (unchanged), seeds (Task 12).

## Task 3: Author migration M3 — salesInvoice propagation, CHECKs, consolidation forks

**Depends on:** none (authoring; timestamp must sort after Task 2's file)
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_exchange-rate-guards-and-consolidation.sql` (via `pnpm db:migrate:new exchange-rate-guards-and-consolidation`)

**Steps:**
1. salesInvoice header→line propagation — fork the SHAPE from the purchase-invoice pair:
   trigger fn + AFTER UPDATE trigger in `20241210214820` (fn ~line 325, fixed in
   `20260616061244_fix_purchase_invoice_line_trigger_exchange_rate_typo.sql:2-13`) and
   the BEFORE INSERT inherit trigger `sync_purchase_invoice_line_exchange_rate_on_insert`
   (`20260616061244:27-43`). Create the salesInvoice equivalents
   (`update_sales_invoice_line_exchange_rate`, `sync_sales_invoice_line_exchange_rate_on_insert`),
   both `DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION` guarded. One-time
   backfill limited to unposted invoices:
   `UPDATE "salesInvoiceLine" sil SET "exchangeRate" = si."exchangeRate" FROM "salesInvoice" si WHERE si."id" = sil."invoiceId" AND si."companyId" = sil."companyId" AND si."status" = 'Draft' AND sil."exchangeRate" IS DISTINCT FROM si."exchangeRate";`
   Check the actual FK column name of `salesInvoiceLine` → header (grep the line table's
   creation in `20250507143421`); if it is not `invoiceId`, use the real name. If PR
   #1527 merged meanwhile and these triggers already exist under other names, STOP and
   reconcile rather than duplicating.
2. Rate positivity on the 12 document tables (quote, salesOrder, purchaseOrder,
   supplierQuote, purchaseInvoice, salesInvoice, quoteLinePrice, salesOrderLine,
   purchaseOrderLine, supplierQuoteLinePrice, purchaseInvoiceLine, salesInvoiceLine),
   each as:
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '<table>_exchangeRate_positive') THEN
       ALTER TABLE "<table>" ADD CONSTRAINT "<table>_exchangeRate_positive" CHECK ("exchangeRate" > 0) NOT VALID;
     END IF;
   END $$;
   ALTER TABLE "<table>" VALIDATE CONSTRAINT "<table>_exchangeRate_positive";
   ```
   If VALIDATE fails locally on real bad rows, STOP and report the offending counts —
   do not add a data-fixing UPDATE without recording it.
3. Consolidation forks. Extract the NEWEST definitions verbatim
   (`sed`/`pg_get_functiondef` per the migration-function-redefinition memory) of
   `translateTrialBalance` (`20260811123614_widen-ledger-amounts.sql:260-333`) and
   `get_consolidation_rates`/`getConsolidationRates` (`20260811123614:303-306`; first
   defined `20260713225803:179-233` — use whichever the newest file defines). Preserve
   signatures and attributes exactly; change ONLY the closing/average sources:
   - closing rate = `target.rate / source.rate` where each side is the latest
     `"exchangeRate"` row with `effectiveDate <= p_period_end` for the target/source
     currency; if either side has NO row ≤ the date (pre-seed history), take that side's
     EARLIEST row instead; never COALESCE to 1.
   - average rate = `AVG(t.rate / s.rate)` over `effectiveDate` in the period where both
     codes have rows on the same date; fall back to the closing rate when the period has
     no paired dates.
   - historical rate = unchanged (`currency."historicalExchangeRate"`).
   The existing multiply convention in the function body is now correct (rate is
   target-per-source) — do not flip any multiplication. If the newest definitions differ
   structurally from the research description (no closing/average branches, different
   param names), STOP and report.

**Verify:**
```bash
grep -c "exchangeRate_positive" packages/database/supabase/migrations/*exchange-rate-guards-and-consolidation.sql
# Expected: >= 24 (12 ADD + 12 VALIDATE)
grep -n "COALESCE(.*, *1)" packages/database/supabase/migrations/*exchange-rate-guards-and-consolidation.sql
# Expected: no hits inside the closing/average rate computations
```

**Out of scope:** quote/SO interceptors and PO/PI/SQ triggers (working — untouched);
`historicalExchangeRate` direction; GL posting-chain conventions (separate July-02 spec).

## Task 4: Apply migrations, regenerate types, psql assertions

**Depends on:** Tasks 1–3
**Steps:**
1. `pnpm db:migrate` (applies all three; regenerates types + swagger; reloads PostgREST).
2. `pnpm run generate:types` if step 1 did not regenerate (it should have).
3. psql assertions against the local DB (connection from `.env.local` `PORT_DB`):

**Verify:**
```bash
psql "$DB_URL" -c "SELECT count(*) FROM \"exchangeRate\";"
# Expected: >= 100 (seed snapshot)
psql "$DB_URL" -c "SELECT get_exchange_rate((SELECT id FROM company LIMIT 1), 'EUR');"
# Expected: a positive numeric ≠ 1 (unless that company's base IS EUR → then exactly 1)
psql "$DB_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'currency' AND column_name = 'exchangeRate';"
# Expected: 0 rows
psql "$DB_URL" -c "SELECT 1 FROM information_schema.tables WHERE table_name = 'exchangeRateHistory';"
# Expected: 0 rows
grep -n "exchangeRateOverride" packages/database/src/types.ts | head -1
# Expected: a hit (types regenerated)
```

**Out of scope:** any TS fixes (later tasks) — typecheck is EXPECTED red after this task.

## Task 5: Models + service layer (accounting module)

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `currencyValidator`
  (~line 416): REMOVE `exchangeRate`; keep `historicalExchangeRate` (change its `.min(0)`
  to `.positive()`); ADD `exchangeRateOverrideValidator = z.object({ currencyCode: z.string().min(1), rate: zfd.numeric(z.number().positive()) })`.
- Modify: `apps/erp/app/modules/accounting/accounting.ee.service.ts`:
  - ADD `getExchangeRate(client, companyId, currencyCode)` → `client.rpc("get_exchange_rate", { p_company_id, p_currency_code })`, returns `{ data: number, error }`.
  - ADD `getExchangeRates(client, companyId)` → `client.rpc("get_exchange_rates", ...)`.
  - ADD `upsertExchangeRateOverride(client, { companyId, currencyCode, rate, userId })` (upsert on `companyId,currencyCode`) and `deleteExchangeRateOverride(client, companyId, currencyCode)`.
  - MODIFY `upsertCurrency` (~3696): drop `exchangeRate` from its accepted fields.
  - MODIFY `getExchangeRateHistory` (~4735): read the global `exchangeRate` table by
    `currencyCode` (latest 90 rows, `effectiveDate` desc) — drop the `companyGroupId` param; update its one caller (`exchange-rates.$currencyId.tsx:34`, adjusted fully in Task 13).
- Modify: `apps/erp/app/modules/accounting/index.ts` barrel if the new exports aren't covered by `export *`.

**Steps:** as listed. Service functions: `client` first arg, return `{data, error}`, never throw (house rule).

**Verify:**
```bash
grep -n "get_exchange_rate\|exchangeRateOverrideValidator\|upsertExchangeRateOverride" apps/erp/app/modules/accounting/accounting.models.ts apps/erp/app/modules/accounting/accounting.ee.service.ts | head
# Expected: all three appear
```

**Out of scope:** callers (Tasks 6–8, 13).

## Task 6: Sweep sales.service.ts stamping sites

**Depends on:** Task 5 (parallel-safe with 7–12)
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — every `getCurrencyByCode` call whose result feeds an `exchangeRate` (research doc §4.2 lists them: quote create/update/convert ~3519/3651/3732/3828; SO ~5327/5441/5600/5660): replace with `getExchangeRate(client, companyId, code)`; on `error` or null data, RETURN the error (no `?? 1`, no fallback). Sites that only need `decimalPlaces` keep `getCurrencyByCode`.
- Modify: quote/SO route actions listed in §4.2 that read the live rate (`x+/quote+/update.tsx:70`, `x+/quote+/$quoteId.tsx:124`, `x+/sales-order+/update.tsx:49,77`) — same replacement. (The `.exchange-rate.tsx` refresh routes are Task 8.)

**Steps:**
1. `grep -n "getCurrencyByCode" apps/erp/app/modules/sales/sales.service.ts apps/erp/app/routes/x+/quote+/*.tsx apps/erp/app/routes/x+/sales-order+/update.tsx` — enumerate every hit; classify rate-consuming vs decimals-only; convert the former.
2. Where a site currently forces `exchangeRate = 1` for the company's own base (e.g. `sales.service.ts:3742, 5670`), keep the semantics but let the resolver return the 1 (it does, by definition) — delete the special-casing only where it is now redundant AND the code reads clearer; do not restructure control flow otherwise.

**Verify:**
```bash
grep -n "exchangeRate ?? 1\|exchangeRate || 1\|\.exchangeRate ?? 1" apps/erp/app/modules/sales/sales.service.ts
# Expected: 0 hits
```

**Out of scope:** documentPreview.server.ts / shared.server.ts decimals-only reads; PDF props.

## Task 7: Sweep purchasing.service.ts stamping sites

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — PO ~1508/1609/1696, supplier quote ~2077/2182/2235/2321 (research §4.2), same conversion as Task 6.
- Modify: `x+/purchase-order+/update.tsx:60,122`, `x+/purchase-order+/$orderId.tsx:282,508`, `x+/purchase-order+/$orderId.finalize.tsx:340`, `x+/supplier-quote+/$id.tsx:63`, `x+/supplier-quote+/update.tsx:73` — same.

**Verify:**
```bash
grep -n "exchangeRate ?? 1\|exchangeRate || 1" apps/erp/app/modules/purchasing/purchasing.service.ts
# Expected: 0 hits
```

**Out of scope:** supplier-price conversion math (PR #1543's territory — direction bugs merge separately).

## Task 8: Sweep invoicing.service.ts + all six exchange-rate refresh routes

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — ~568/729 (PI), ~946/1107 (SI), same conversion.
- Modify: the six refresh routes — `x+/quote+/$quoteId.exchange-rate.tsx`, `x+/sales-order+/$orderId.exchange-rate.tsx`, `x+/purchase-order+/$orderId.exchange-rate.tsx`, `x+/supplier-quote+/$id.exchange-rate.tsx`, `x+/purchase-invoice+/$invoiceId.exchange-rate.tsx`, `x+/sales-invoice+/$invoiceId.exchange-rate.tsx`: the action must (a) read the DOCUMENT row's `currencyCode` (never a POSTed code/rate — subsumes #1530), (b) `getExchangeRate(client, companyId, documentCurrencyCode)`, (c) call the existing `update*ExchangeRate` service fn with that rate. Also `x+/purchase-invoice+/$invoiceId.tsx:79`, `x+/purchase-invoice+/update.tsx:56,137`, `x+/sales-invoice+/$invoiceId.tsx:80`, `x+/sales-invoice+/update.tsx:55`.

**Verify:**
```bash
grep -rn "formData.get(\"exchangeRate\")\|formData.get(\"currencyCode\")" apps/erp/app/routes/x+/*/*exchange-rate.tsx
# Expected: 0 hits (rate/code never client-supplied on refresh)
grep -n "exchangeRate ?? 1" apps/erp/app/modules/invoicing/invoicing.service.ts
# Expected: 0 hits
```

**Out of scope:** invoice posting edge functions (snapshot consumers — untouched).

## Task 9: Edge functions `convert` + `create` → resolver

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/supabase/functions/convert/index.ts` (~1084): replace the `currency` table read + refuse-on-missing block with one RPC: `client.rpc("get_exchange_rate", { p_company_id: companyId, p_currency_code: code })`; keep the error path (throw with the RPC's error message).
- Modify: `packages/database/supabase/functions/create/index.ts` (~541): same replacement; DELETE the `?? 1`. A resolver error must fail the operation (throw), not default.

**Verify:**
```bash
grep -n "from(\"currency\")" packages/database/supabase/functions/convert/index.ts packages/database/supabase/functions/create/index.ts
# Expected: 0 hits
grep -n "?? 1" packages/database/supabase/functions/create/index.ts | grep -i exchange
# Expected: 0 hits
```

**Out of scope:** `deno check` exit codes (pre-existing shared-graph errors — gate on own-file deltas only, per lessons); all other edge functions (snapshot consumers).

## Task 10: Jobs — rewrite feed job, kill paperless-parts duplicate

**Depends on:** Task 4
**Files:**
- Modify: `packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts` — full rewrite, SAME function id `update-exchange-rates`, SAME cron `0 0 * * *`:
  1. Move the `ExchangeRatesClient` class + `getExchangeRatesClient` from `packages/ee/src/exchange-rates/exchange-rates.server.ts` INTO this file (or a sibling `update-exchange-rates.lib.ts`) — `@carbon/ee/exchange-rates.server` will be deleted in Task 11.
  2. No `companyIntegration` scan. Flow: if no `EXCHANGE_RATES_API_KEY`, `logger.info` + return. Fetch EUR-based rates once. Convert to USD anchor: `usdRate = rates["USD"]`; for each code in the payload, `rate = round(rates[code] / usdRate)` (`round` from `@carbon/utils`, default scale — never display decimals). Read the `currencyCode` list (service role, `from("currencyCode").select("code")` — reference table, no tenancy); upsert into the global `exchangeRate` table one row per code present in BOTH lists: `{ currencyCode, effectiveDate: <today UTC date>, rate, updatedAt }`, `onConflict: "currencyCode,effectiveDate"`. For today's date use `datetime.timestamp()`-derived UTC day per date-handling rules (no `new Date().toISOString().split`— use the `datetime` API from `@carbon/utils`).
  3. Log codes present in `currencyCode` but absent from the feed (stale-warning from PR #1542's design).
- Modify: `packages/jobs/src/inngest/functions/integrations/paperless-parts.ts` (~808): replace the local `getCurrencyByCode` (currency-table read) with `serviceRole.rpc("get_exchange_rate", { p_company_id: companyId, p_currency_code: code })`; a resolver error skips stamping with a logged warning (imported quotes must not fail outright — preserve current failure behavior).

**Verify:**
```bash
grep -n "companyIntegration\|exchange-rates-v1" packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts
# Expected: 0 hits
grep -n "from(\"currency\")" packages/jobs/src/inngest/functions/integrations/paperless-parts.ts
# Expected: 0 hits
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** other scheduled jobs; Inngest event names (none added/removed).

## Task 11: Delete the exchange-rates integration from @carbon/ee

**Depends on:** Task 10 (the client class must be moved first)
**Files:**
- Delete: `packages/ee/src/exchange-rates/` (both files).
- Modify: `packages/ee/src/index.ts` — remove the `ExchangeRates` import (~line 2) and its entry in the `integrations` array (~line 35).
- Modify: `packages/ee/src/plan.ts` — remove `"exchange-rates-v1"` from `INTEGRATION_WHITELIST` (~line 31).
- Modify: `packages/ee/package.json` — remove the `./exchange-rates.server` export subpath.

**Verify:**
```bash
grep -rn "exchange-rates" packages/ee/src/ packages/ee/package.json
# Expected: 0 hits
grep -rn "@carbon/ee/exchange-rates.server" --include="*.ts" apps packages
# Expected: 0 hits
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** other integrations; `hooks.server.ts` (exchange-rates never had hooks).

## Task 12: Seed paths + backup scoping pins

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` (~484): remove `exchangeRate: 1` from every entry of `currencies` (keep code/decimalPlaces/createdBy).
- Modify: `packages/database/supabase/functions/seed-company/index.ts` (~335): the insert maps the slimmed rows — verify no explicit `exchangeRate` reference remains.
- Modify: `packages/database/src/datasets/bootstrap.ts` (~300): drop `"exchangeRate"` from the INSERT column list and values.
- Modify: `packages/jobs/src/backups/scope.test.ts` (~278): `currency` stays `companyGroupId`-scoped; ADD pins — `exchangeRate` as a non-tenant reference table (mirror how `currencyCode` is classified in that file) and `exchangeRateOverride` as `companyId`-scoped. If `currencyCode` has no explicit pin there, follow whatever mechanism the test uses for global tables; if none exists, STOP and check how `pnpm db:check:backups` classifies `exchangeRate` before inventing a pattern.

**Verify:**
```bash
grep -rn "exchangeRate" packages/database/supabase/functions/lib/seed.data.ts packages/database/src/datasets/bootstrap.ts
# Expected: 0 hits
pnpm --filter @carbon/jobs test -- scope
# Expected: scope tests pass
```

**Out of scope:** dataset tier files (they don't write currency — verified in research).

## Task 13: UI — exchange-rates page: resolved rates, provenance, overrides

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/exchange-rates.tsx` — loader calls `getExchangeRates(client, companyId)` (company-resolved list) instead of `getCurrencies`.
- Modify: `apps/erp/app/routes/x+/accounting+/exchange-rates.$currencyId.tsx` — loader: config row via `getCurrency` + resolved rate via `getExchangeRate` + history via reworked `getExchangeRateHistory`; action: two intents — `override` (validate `exchangeRateOverrideValidator` → `upsertExchangeRateOverride`) and `reset` (→ `deleteExchangeRateOverride`); config-field edits (decimalPlaces, historicalExchangeRate, customFields) keep going through `currencyValidator` → `upsertCurrency`. Keep the `clientAction` cache invalidation exactly as-is (`currenciesQuery` setQueryData null).
- Modify: `apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx` and the table component in the same directory:
  - Copy from (precedent): the existing files themselves — keep layout/structure; change data wiring only.
  - Rate field: shows the resolved rate; editing + submit creates the override; a provenance `Badge` (grep `packages/react/src` for `Badge`) shows "Market rate" / "Your rate" / "Base currency"; a "Reset to market rate" button (renders only when source is `override`) posts the `reset` intent.
  - Base-currency row: rate displayed as 1, input disabled (server-true now — the resolver returns 1).
  - Keep the helper text "One {base} is equal to how many {code}?".
  - History chart: feed it the global-store rows (market line).
  - All new user-facing strings marked for i18n per the house pattern (`useLingui().t` / `<Trans>`).
- Modify: `apps/erp/app/utils/path.ts` — only if a new route path is needed (none expected; overrides post to the existing `$currencyId` route).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (this is the first task after which erp must be green)
```

**Out of scope:** document forms/refresh buttons (unchanged UI); new routes.

## Task 14: Full scoped validation

**Depends on:** Tasks 5–13
**Steps:**
1. `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/ee --filter=@carbon/database` — expect exit 0.
2. `pnpm run lint` — expect no new errors (Biome).
3. `pnpm run test` — expect suites green (notably `@carbon/jobs` scope tests).
4. Global sweep asserts:

**Verify:**
```bash
grep -rn "\.exchangeRate ?? 1\|\.exchangeRate || 1" apps/erp/app/modules apps/erp/app/routes packages/database/supabase/functions/convert packages/database/supabase/functions/create packages/jobs/src
# Expected: 0 hits
grep -rn "from(\"currency\")" apps/erp/app/modules apps/erp/app/routes | grep -v "currencyCode"
# Expected: only config reads (getCurrency/getCurrencies/upsertCurrency in accounting service) — no rate consumers
```

## Task 15: Dataset + backup pre-commit gates

**Depends on:** Task 14
**Steps:**
1. `pnpm db:check:datasets` — all four datasets apply (the seed no longer writes `exchangeRate`).
2. `pnpm db:check:backups` — restore verdict OK with the `exchangeRateHistory` rename entry and new tables classified.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: exit 0, all datasets apply + roll back
pnpm db:check:backups
# Expected: exit 0 verdict (not a refusal)
```

## Task 16: Browser verification (/test)

**Depends on:** Task 15
**Steps:** Run the `/test` skill against the running local stack (`crbn up`, portless). Flows, minimum:
1. `/x/accounting/exchange-rates` — list renders resolved rates with provenance badges; base currency shows 1.
2. Edit a foreign rate → badge flips to "Your rate"; reset → back to "Market rate".
3. Create a quote for a customer with a foreign currency → header `exchangeRate` stamps a real (≠1) rate; refresh button re-resolves.
4. Sales invoice: change header rate via refresh → line rates follow (new trigger).
5. Settings → Integrations: no Exchange Rates card.

**Verify:** /test pass/fail table — all five flows pass. Screenshots captured for the PR.

## Task 17: Docs sync (carbon-docs)

**Depends on:** Task 14
**Steps:** Using the `carbon-docs` skill, update the docs site page(s) that describe
exchange rates/currencies/integrations (search `docs/content` for "exchange rate"):
rates are automatic for every company; manual overrides + reset; the integration no
longer exists. Ground every claim in the shipped code.

**Verify:**
```bash
grep -rn "exchange rate" docs/content --include="*.mdx" -il | head
# Expected: the touched pages; docs build passes (pnpm --filter docs build) if content changed
```

---

## Appendix A — bootstrap snapshot (units of currency per 1 USD, approx. 2026-09)

USD 1, EUR 0.92, GBP 0.79, JPY 155, CHF 0.88, CAD 1.36, AUD 1.52, NZD 1.64, CNY 7.2,
HKD 7.8, TWD 32, KRW 1350, SGD 1.34, INR 84, IDR 15800, MYR 4.6, PHP 57, THB 35,
VND 25000, BRL 5.5, MXN 18.5, ARS 1000, CLP 950, COP 4100, PEN 3.8, UYU 40, BOB 6.9,
PYG 7500, VES 40, ZAR 18, EGP 48, NGN 1550, KES 130, GHS 15, MAD 10, TND 3.1, DZD 135,
LYD 4.9, ETB 120, TZS 2600, UGX 3700, XOF 600, XAF 600, MUR 46, BWP 13.5, ZMW 26,
MZN 64, AOA 850, SEK 10.5, NOK 10.7, DKK 6.9, ISK 138, PLN 4.0, CZK 23, HUF 360,
RON 4.6, BGN 1.8, RSD 108, ALL 93, MKD 57, BAM 1.8, MDL 18, UAH 41, BYN 3.3, RUB 95,
TRY 34, GEL 2.7, AMD 390, AZN 1.7, KZT 480, KGS 87, UZS 12700, TJS 10.6, TMT 3.5,
AED 3.67, SAR 3.75, QAR 3.64, KWD 0.31, BHD 0.376, OMR 0.385, JOD 0.709, ILS 3.7,
LBP 89500, IQD 1310, IRR 42000, AFN 70, PKR 278, BDT 120, LKR 300, NPR 134, MMK 2100,
KHR 4100, LAK 21800, MNT 3450, BND 1.34, FJD 2.25, PGK 3.9, WST 2.7, TOP 2.35,
XPF 109, JMD 156, TTD 6.8, BBD 2, BSD 1, BZD 2, XCD 2.7, AWG 1.79, ANG 1.79, DOP 60,
HTG 132, CUP 24, GTQ 7.75, HNL 24.7, NIO 36.8, CRC 520, PAB 1, SVC 8.75, GYD 209,
SRD 36, KYD 0.82, BMD 1, CVE 101, GMD 68, GNF 8600, LRD 195, SLL 22000, SLE 22,
STN 22.5, SZL 18, LSL 18, NAD 18, MWK 1730, RWF 1350, BIF 2900, DJF 178, ERN 15,
SOS 570, SDG 600, SSP 1300, CDF 2800, KMF 452, SCR 13.5, MGA 4500, MVR 15.4, BTN 84,
YER 250, SYP 13000, HRK 6.9, VUV 119, SBD 8.4, MOP 8.03, BAT 35, GIP 0.79, FKP 0.79,
SHP 0.79, IMP 0.79, JEP 0.79, GGP 0.79, EEK 14.4, LTL 3.18, LVL 0.65, ZWL 6100

Amendment (2026-09-02, execute Task 1): seed.data.ts carries two obsolete codes absent
above — VEF 4000000 (VES 40 × 100000 redenomination) and ZMK 26000 (ZMW 26 × 1000).
Added with successor-peg conversions rather than invented values.

(Executor: match against `seed.data.ts` codes; drop appendix entries whose code is not in
`currencyCode`; STOP if a seed code has no appendix entry. Values are a bootstrap
fallback overwritten by the first feed run — approximate is acceptable, 1.0 is not.)
