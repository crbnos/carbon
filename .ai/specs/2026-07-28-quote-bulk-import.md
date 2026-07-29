# PRD: Bulk CSV Import for Sales Quotes

- **Status:** Phase 1 implemented (2026-07-28) on branch `feat/quote-bulk-import`. Decisions: **Option B** (app-side, reuse services), **3 modes**, **create-only idempotency**. Q4 = customer by name/readableId + part by number; Q5 = dedicated "Quote Group" column; Q6 = Quotes table only; Q7 = explicit prices only. Files: `sales.import.server.ts` (engine), `imports.models.ts` (config), `import.$tableId.tsx` (route branch), `QuotesTable.tsx` (dropdown).
- **Date:** 2026-07-28
- **Author:** research + PRD via Claude
- **Module:** `sales`
- **Analogous prior art:** Parts / BOM / BOP CSV import ([#911](https://github.com/crbnos/carbon/pull/911), [#1194](https://github.com/crbnos/carbon/pull/1194))

---

## 1. Summary

Add a **bulk CSV import for sales quotes**, mirroring the existing Parts/BOM/BOP
("method") import. A user uploads one CSV and Carbon creates quotes — headers,
their lines, and quantity-break pricing — in one operation, reusing the existing
generic import wizard (upload → column-map → results).

The BOM/BOP import exposes **four modes** (`part`, `bom`, `operations`,
`partWithMethod`). The quote analog is a small set of modes over a
**parent → children hierarchy** (`quote` → `quoteLine` → `quoteLinePrice`),
discriminated by a per-row **Row Type** column exactly like the method import's
`PART / BOM / BOP / STEP / TOOL / PARAM`.

---

## 2. Problem & motivation

Quotes today are created one at a time through the UI (`insertQuote` +
per-line `upsertQuoteLine` + pricing). A shop migrating from another system, or
one that prepares quotes in spreadsheets, has no way to load many quotes/lines at
once. Parts already have this (BOM/BOP import); quotes are the natural next
document to get the same treatment, and the import framework is fully generic —
only quote-specific config and a row handler are missing.

---

## 3. Goals / non-goals

### Goals
- Import **quote headers** (customer, dates, references, sales/estimator, etc.).
- Import **quote lines** against an item (resolved by part number), with
  description, method type, UoM, and quantity breaks.
- Import **explicit quantity-break pricing** (`unitPrice`, `discountPercent`,
  `leadTime`, `shippingCost`) per line.
- Reuse the existing import wizard UI, column mapping, enum mapping, template
  download, and results modal **unchanged**.
- Be **idempotent / re-runnable** via the shared `externalIntegrationMapping`
  (`integration = "csv"`) mechanism, keyed on a user-supplied external quote id.
- Respect quote-creation side effects (opportunity, payment, shipment, external
  link) — do **not** write raw `quote` rows that skip them.

### Non-goals (Phase 1)
- **No automatic cost rollup / price resolution.** Make-to-Order lines will
  *not* auto-pull the item's BOM/routing or run `resolvePrice` / `applyPriceRules`
  / cost rollup during import. Prices come from the CSV (explicit). Rationale:
  replicating the pricing engine in the importer is large and high-drift. (Users
  can still open a line and recalculate afterward.)
- No import of `quoteMaterial` / `quoteMakeMethod` / `quoteOperation` (the
  line's BOM/routing). That is a large second effort analogous to the whole
  method import; defer to Phase 2.
- No quote → order conversion, no RFQ import.
- No new export format (the generic Table "Download CSV" already exists).

---

## 4. Background: how the BOM/BOP import works (the template we copy)

Verified against the current code. The import system has three layers, all
**generic and table-driven** — adding a type is mostly declarative config plus a
row handler.

**Flow**

```
Quotes table "Bulk Import" dropdown  (importCSV prop on <Table>)
  → ImportCSVModal  (2-step wizard)
      UploadCSV.tsx    — PapaParse client-side; upload to `private` bucket
                         at `${companyId}/imports/${nanoid()}.csv`; template download
      FieldMappings.tsx — map CSV columns → Carbon fields (+ enum value mapping)
  → POST /x/shared/import/$tableId    (import.$tableId.tsx — action only)
      requirePermissions({ update: importPermissions[table] })
      validate importSchemas[table].extend({ filePath, enumMappings })
      importCsv(getCarbonServiceRole(), { table, filePath, columnMappings, enumMappings, companyId, userId })
  → edge fn `import-csv/index.ts`  (Deno): download CSV, apply mappings, switch(table)
      bom/operations/partWithMethod → importMethods() in method-import.ts
  → ImportResultsModal   { inserted, updated, errors[], skipped[] }
```

**Config lives in three maps** in
`apps/erp/app/modules/shared/imports.models.ts`, all keyed by table name:
- `fieldMappings[table]` — per-column `{ label, required, type: "string"|"number"|"boolean"|"enum", default?, enumData? }`. `enumData` may carry static `options`, a dynamic `fetcher(client, companyId)`, or `creatableLookup`/`creatableForm`.
- `importPermissions[table]` — `table → module` (gates the route). Exhaustive over `keyof fieldMappings` (TS enforces).
- `importSchemas[table]` — a `z.ZodObject` for validation (method schemas keep every cell an optional string; authoritative validation is in the edge fn).

**The hierarchical engine** (`method-import.ts`, ~950 lines) is the real
template for quotes:
1. **Classify + group** rows by parent (`readableId`+`revision`) using a required
   **Row Type** column.
2. **Batch-resolve references** (items by readable id, UoM, processes…), with
   ambiguity detection; same-file-created parents count as resolvable.
3. **Validate per group.**
4. **Write per group inside one Kysely transaction** → atomic per parent.
   Create-only / fill-if-empty (re-running skips already-populated targets).

**Discoverability** is a one-line `importCSV` prop on the table:
```tsx
// PartsTable.tsx
importCSV={[
  { table: "part",           label: t`Parts` },
  { table: "bom",            label: "BOM" },
  { table: "operations",     label: "Operations" },
  { table: "partWithMethod", label: "Parts with Methods" },
]}
```

**Confirmed facts that shape the quote design**
- The edge fn's `importCsvValidator.table` is a **hardcoded `z.enum`** — a new
  table **must** be added there or the route call is rejected (this is the gate
  that made `fixedAsset` a dead entry: it's in the models but not the enum).
- `import-csv` is **not** in `config.toml` yet deploys/runs — **no config.toml
  change needed** to extend it.
- The edge fn re-checks a coarse `{ create: "resources" }` permission in addition
  to the route's real per-table gate.
- Row numbers in results are **0-based indices** into the parsed rows.
- Client parses with PapaParse; edge fn parses with Deno std — separate parsers.

---

## 5. Quote data model (what we must produce)

Reconciled to current schema (base tables in `20240715024405_quotes.sql` +
~40 later ALTER migrations).

### `quote` (header) — PK `id` (`xid()`), unique `(quoteId, companyId)`
- **Hard-required business input:** `customerId` (FK→customer).
- `quoteId` (human id `QUO000001`) is **auto-generated** via
  `get_next_sequence("quote", companyId)` when not supplied.
- Validator (`quoteValidator`) also requires **`locationId`** (form-level; the
  column is nullable — import should default to the company's default location
  when the CSV omits it).
- Optional: `expirationDate`, `dueDate`, `customerReference`,
  `customerLocationId`, `customerContactId`, `salesPersonId`, `estimatorId`,
  `currencyCode`, `status`, `notes`.

### `quoteLine` — PK `id` (`xid()`)
Required: `quoteId`, **`itemId`** (resolved from part number), `status`,
**`description`**, `methodType`, `unitOfMeasureCode`, `quantity NUMERIC[]`
(each ≥ 0.00001), `taxPercent` (0–1). Denormalized `itemReadableId`.
- `methodType` enum (current): **`Purchase to Order`, `Pull from Inventory`,
  `Make to Order`** (legacy `Buy`/`Pick`/`Make`).
- `quoteLineStatusType`: `Not Started, In Progress, Complete, No Quote`.

### `quoteLinePrice` — PK **`(quoteLineId, quantity)`**, no `id`
`unitPrice`, `discountPercent` (**fraction 0–1, not 0–100**), `leadTime`,
`shippingCost`, `exchangeRate`, `categoryMarkups` (JSONB). Net/extended/converted
prices are **generated STORED** columns. Written via `upsertQuoteLinePrices`
(delete-then-reinsert per line; preserves discount/leadTime/categoryMarkups).

### Auto-created side effects (⚠ critical)
`insertQuote` / `upsertQuote` also create: an **`opportunity`**, **`quotePayment`**
(from the customer's payment defaults), **`quoteShipment`** (from shipping
defaults), and an external portal link. Make-to-Order line inserts trigger a root
`quoteMakeMethod`. **A raw table insert skips all of this** — the import must go
through the real creation path.

### Service functions to reuse
- `insertQuote(client, input)` — header + all side effects; auto-sequences quoteId.
- `upsertQuoteLine(client, line)` — insert (computes `sortOrder`) / update.
- `upsertQuoteLinePrices(client, quoteId, lineId, prices[])` — quantity-break prices.
- `getQuoteByExternalId(client, externalId)` — idempotency lookup.

---

## 6. Proposed feature

### 6.1 Modes (the "4 options" analog)

Recommended **three** modes, mirroring the part/bom/operations/partWithMethod
symmetry (the combined mode is the flagship):

| Mode (`table`) | CSV contains | Use case |
|---|---|---|
| `quote` | Header rows only | Load many empty quotes (headers) |
| `quoteLine` | Line + price rows keyed to an **existing** quote (by `quoteId`) | Add lines to quotes that already exist |
| `quoteWithLines` | Header + Line + Price rows, one file | **Flagship:** create whole quotes end-to-end |

> A fourth "prices only" mode (like `bom` for parts) is possible but low value —
> pricing is naturally imported with its line. Recommend **not** shipping it in
> Phase 1. (Open question Q1.)

### 6.2 CSV shape — Row Type discriminator

`quoteWithLines` (and `quoteLine`) use a **Row Type** column, exactly like
`partWithMethod`:

- `QUOTE` — a header row. Carries customer, dates, references.
- `LINE` — a quote line. Carries item/part number, description, method type, UoM,
  a single quantity, and (optionally) that quantity's price fields.

Because a *new* quote has no human key until `quoteId` is generated, rows are
tied together by a **Quote Group** column (user-authored key, e.g. a PO number or
a temporary import id). All rows sharing a Quote Group belong to one quote; the
first `QUOTE` row is the header, subsequent `LINE` rows are its lines. The Quote
Group value doubles as the **external id** for idempotency (see §7).

Quantity breaks: one `LINE` row = one item + one quantity + its price. Multiple
quantity breaks for the same item = multiple `LINE` rows with the same
item/description and different `quantity`/`unitPrice` (the handler groups them
into one `quoteLine` with a `quantity[]` array + N `quoteLinePrice` rows). This
matches how method import represents repeated child rows.

### 6.3 Proposed columns (`fieldMappings`)

**Header (`QUOTE`) columns**
| Field | Req | Type | Notes |
|---|---|---|---|
| `externalId` (Quote Group) | ✓ | string | groups rows + idempotency key |
| `rowType` | ✓ (combined/line) | enum | `QUOTE` / `LINE` |
| `customerId` | ✓ | enum | resolve by customer **name or readableId** → `customer.id` |
| `customerReference` | – | string | |
| `customerLocationId` | – | enum | fetcher over customer locations |
| `customerContactId` | – | enum | fetcher over customer contacts |
| `locationId` | – | enum | default → company default location |
| `salesPersonId` | – | enum | match employee by email |
| `estimatorId` | – | enum | match employee by email |
| `expirationDate` | – | string | ISO date |
| `dueDate` | – | string | ISO date |
| `currencyCode` | – | enum | default → company currency |
| `status` | – | enum | default `Draft` |

**Line (`LINE`) columns**
| Field | Req | Type | Notes |
|---|---|---|---|
| `itemReadableId` (Part Number) | ✓ | string | resolve → `item.id` (reuse method-import resolver) |
| `description` | ✓ | string | |
| `methodType` | – | enum | default `Pull from Inventory` |
| `unitOfMeasureCode` | – | enum | default from item / `EA` |
| `quantity` | ✓ | number | single break |
| `unitPrice` | ✓ | number | |
| `discountPercent` | – | number | **fraction 0–1** (validate/convert) |
| `leadTime` | – | number | |
| `shippingCost` | – | number | |
| `taxPercent` | – | number | 0–1, default 0 |
| `lineStatus` | – | enum | default `Not Started` |
| `customerPartId` | – | string | |

`importSchemas.quoteWithLines` keeps all cells optional-string (like the method
schemas); authoritative validation is in the handler.

---

## 7. Idempotency

Reuse the shared `externalIntegrationMapping` table (`integration = "csv"`), the
same mechanism the customer/supplier/item imports use:
- The **Quote Group / externalId** column is the CSV external id for the quote.
- On import, build `externalId → quote.id` map (via `getCsvExternalIdMap`, or
  `getQuoteByExternalId` on the `quote.externalId` JSONB column).
- Existing external id → **update** the header / append-or-update lines; else
  **create**. Persist the mapping via `upsertCsvMappings`.
- Add `"quote"` to the edge fn's `CsvEntityType` union + `fetchLiveEntityIds`
  switch if we want live-id reconciliation.

**Create-only vs update semantics** need a decision (Q3): safest Phase-1 default
is *create-only* — if a quote with that external id already exists, **skip** it
(report in `skipped[]`), matching the method import's "don't clobber" stance.

---

## 8. Architecture decision — RESOLVED: Option B (app-side, reuse services)

The generic imports run entirely in the **Deno edge function** with **Kysely**
direct writes. Quotes are different: quote creation lives in **app service code**
(`insertQuote`, etc.) as `supabase-js` calls with substantial business logic
(sequence, opportunity, payment/shipping defaults, external link). Two paths:

### Option A — Edge function `quote-import.ts` (consistency-first)
Add `case "quote"` delegating to a new `quote-import.ts` (like `method-import.ts`)
that **replicates** `insertQuote` + line + price logic in Deno with Kysely/
service-role.
- **Pros:** identical to every other import; one code path; per-quote atomic
  transaction is natural.
- **Cons:** must **re-implement and keep in sync** ~250 lines of quote-creation
  business logic (opportunity, payment/shipping defaults, external link, sequence)
  plus line/price logic. High drift risk. Directly contradicts the sales module's
  rule that quote writes go through services.

### Option B — App-side `importQuotes` service, invoked by the route (recommended)
Special-case the route: for `table === "quote*"`, call a new app-side
`importQuotes()` service (in `sales.service.ts` or a `sales.import.server.ts`)
that downloads + parses the CSV, applies column/enum mappings, and loops calling
the **existing** `insertQuote` / `upsertQuoteLine` / `upsertQuoteLinePrices` with
the service-role client — one quote at a time, each wrapped for partial-failure
reporting.
- **Pros:** **zero duplication** of quote business logic; automatically respects
  opportunity/payment/shipment/external-link/pricing rules; honors the sales
  safety conventions; changes to quote creation flow through automatically.
- **Cons:** introduces a second import execution path (app-side vs edge fn);
  must replicate the small CSV-parse + mapping-apply step app-side (~40 lines,
  PapaParse is available); per-row atomicity is weaker than a single Kysely txn
  (mitigated: each quote created independently, failures reported per group).

**Recommendation: Option B.** The quote-creation logic is too large and too
safety-sensitive to fork into Deno. Reusing the services is the "no laziness /
root-cause / minimal-drift" choice and matches `sales/AGENTS.md` ("MUST use…
services", "never compute prices ad hoc"). The entire wizard UI, upload, mapping,
template, results modal, route shell, and permission gate are still reused — only
the execution backend differs for quotes.

> If the team values single-path consistency over drift risk, Option A is viable
> but should budget for careful replication + tests against `insertQuote`.

---

## 9. Touchpoints (files to change)

**Shared (both options)**
1. `apps/erp/app/modules/shared/imports.models.ts` — add `quote` / `quoteLine` /
   `quoteWithLines` to `fieldMappings`, `importPermissions` (→ `"sales"`),
   `importSchemas`. Add reusable column fragments (header fields, line fields).
2. `apps/erp/app/modules/sales/ui/Quotes/QuotesTable.tsx` — add `importCSV`
   prop with the 3 modes (gated on `permissions.can("create", "sales")`).
3. `apps/erp/app/modules/sales/sales.models.ts` — export any new import-specific
   types if needed (row shapes).

**Option A (edge fn)**
4. `packages/database/supabase/functions/import-csv/index.ts` — add the tables to
   `importCsvValidator.table` enum; add `case "quote*"` → `importQuotes(db, …)`;
   extend `CsvEntityType` + `fetchLiveEntityIds`.
5. `packages/database/supabase/functions/import-csv/quote-import.ts` — new engine
   (group by Quote Group, resolve customer/item/UoM, replicate insertQuote/line/
   price, per-group transaction, create-only skip).

**Option B (app-side, recommended)**
4. `apps/erp/app/routes/x+/shared+/import.$tableId.tsx` — branch: for quote
   tables, call the app-side `importQuotes` instead of `importCsv` (edge fn).
5. `apps/erp/app/modules/sales/sales.import.server.ts` (new) — `importQuotes()`:
   download from `private` bucket, PapaParse, apply `columnMappings`/`enumMappings`,
   group by Quote Group, resolve customer/item/UoM readable ids → ids, loop
   `insertQuote`/`upsertQuoteLine`/`upsertQuoteLinePrices`, collect
   `{ inserted, updated, errors[], skipped[] }` in the same result shape the
   `ImportResultsModal` expects.

**No change needed:** `ImportCSVModal`, `UploadCSV`, `FieldMappings`,
`ImportResultsModal`, `path.to.import`, `config.toml`.

---

## 10. Scope & phasing

- **Phase 1 (this PRD):** headers + lines + explicit quantity-break pricing;
  create-only idempotency; no cost rollup. Modes `quote`, `quoteLine`,
  `quoteWithLines`.
- **Phase 2 (future):** import quote-line **methods** (`quoteMaterial` /
  `quoteMakeMethod` / `quoteOperation`) — the quote analog of the full BOM/BOP
  import; optional auto price recalculation for Make-to-Order.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Skipping quote side effects (opportunity/payment/shipment/link) with raw inserts | Go through `insertQuote` (Option B) or faithfully replicate (Option A) |
| `discountPercent` entered as 0–100 not 0–1 | Validate range; document in template; consider auto-detect/convert with a warning |
| Ambiguous customer/item resolution (dup names) | Reuse method-import's ambiguity detection; prefer readableId; error the row |
| Partial failure mid-file | Per-quote isolation + per-group error reporting in `errors[]`; create-only avoids half-updates |
| Pricing drift if replicated in Deno (Option A) | Prefer Option B; if A, add tests pinning parity with `insertQuote` |
| Make-to-Order lines expecting rollup | Documented non-goal; prices are explicit in Phase 1 |
| Models/edge-enum drift (the `fixedAsset` trap) | Keep `fieldMappings` and the execution path's accepted tables in sync; add a test |

---

## 12. Verification plan

- **Unit:** row grouping (Quote Group → header + lines), quantity-break
  aggregation, readable-id resolution, discountPercent validation, create-only
  skip. (vitest, `--testPathPattern=sales`.)
- **Type/lint:** `pnpm exec turbo run typecheck --filter=@carbon/erp`, `pnpm run lint`.
- **Manual/e2e (`/test`):** upload a `quoteWithLines` CSV → verify quotes,
  lines, and prices created; opportunity/payment/shipment exist; re-run same file
  → all skipped (idempotent); malformed rows surface in the results modal.
- **Fixtures:** sample CSVs for each mode; the wizard's template download should
  produce a valid starting file.

---

## 13. Open questions

**Resolved 2026-07-28:**
- **Q1 — Modes:** ✅ **3 modes** (`quote`, `quoteLine`, `quoteWithLines`).
- **Q2 — Architecture:** ✅ **Option B** — app-side `importQuotes`, reuse services.
- **Q3 — Idempotency:** ✅ **Create-only skip** for Phase 1 (skip existing external ids).

**Still open (low-risk; recommended defaults apply unless changed):**
- **Q4 — Customer/item keys:** Accept **name or readableId** for customer, and
  **part number (readableId)** for items? Any support for raw ids? *(Recommend
  name-or-readableId, no raw ids.)*
- **Q5 — Grouping key:** Use a dedicated **Quote Group** column as external id, or
  reuse `customerReference`? *(Recommend a dedicated column so `customerReference`
  stays a real business field.)*
- **Q6 — Where does the import button live?** Quotes list table only, or also
  Opportunities? *(Recommend Quotes table only for Phase 1.)*
- **Q7 — Pricing scope:** Confirm Phase 1 imports **explicit** prices only (no
  `resolvePrice`/rollup). *(Recommend yes.)*

---

## 14. References

- Prior art: [#911 Import BOM & BOP](https://github.com/crbnos/carbon/pull/911),
  [#1194 Parts-with-Methods](https://github.com/crbnos/carbon/pull/1194)
- Rules: `.claude/rules/csv-import-system.md`, `.claude/rules/quote-discount-system.md`,
  `.claude/rules/workflow-edge-function.md`
- Code: `apps/erp/app/modules/shared/imports.models.ts`,
  `apps/erp/app/components/ImportCSVModal/`,
  `apps/erp/app/routes/x+/shared+/import.$tableId.tsx`,
  `packages/database/supabase/functions/import-csv/{index,method-import}.ts`,
  `apps/erp/app/modules/sales/{sales.models,sales.service}.ts`,
  `apps/erp/app/modules/sales/AGENTS.md`
