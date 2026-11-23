# Deep search on order and quote lists — implementation plan

**Spec / source:** .ai/specs/2026-11-02-deep-list-search.md
**Research:** .ai/research/2026-11-02-deep-list-search.md
**Closest sibling:** Inventory → Receiving (`purchaseOrderLinesToReceive`, `inventory.utils.ts`, `ui/Receiving/ReceivingTable.tsx`). This plan copies its search rule and its expanded-line look, then removes it.
**Branch:** feat/deep-list-search

## Progress

- [x] Task 0: Check the prerequisites
- [x] Task 1: Spike — prove a computed field filters on a view
- [x] Task 2: Add the full search migration
- [x] Task 3: Regenerate the database types
- [x] Task 4: Move the search helpers to `~/utils/search`
- [x] Task 5a: Search lines in the purchasing services
- [x] Task 5b: Search lines in the sales services
- [x] Task 5c: Search lines in the invoicing services
- [x] Task 6: Add the matched-lines component and pin the Expand column
- [x] Task 6b: Show matched lines in the 8 list tables
- [x] Task 7: Remove Inventory → Receiving
- [x] Task 8: Reuse the Draft receipt of a purchase order
- [x] Task 9: Update docs, rules, AGENTS.md and the catalogs
- [x] Task 10: Run the final verification

## Dependencies

- Task 0 comes first. Every other task needs it.
- Task 1 needs Task 0. Task 2 needs Task 1. Task 3 needs Task 2.
- Task 4 is independent of Tasks 1, 2 and 3. It can run any time after Task 0.
- Tasks 5a, 5b and 5c each need Tasks 3 and 4. They are independent of each other.
- Task 6 needs Task 4. Task 6b needs Tasks 5a, 5b, 5c and 6.
- Task 7 needs Tasks 2 and 4 (Task 2 drops the view; Task 4 moves the helpers).
- Task 8 is independent of Tasks 1 to 7. It needs only Task 0.
- Task 9 needs Tasks 5a to 8.
- Task 10 runs last.

## Rules for every task

- Work only in `/Users/aashu/work/carbon/carbon-feat-deep-list-search`. Never touch `/Users/aashu/work/carbon/carbon`.
- Run one heavy command at a time (typecheck, vitest, lingui, `db:migrate`). The machine is low on memory.
- 🛑 Never rebuild or reset the database. If `pnpm db:migrate` fails, STOP and report.
- 🛑 Never commit. The user commits.
- Start every new `.ts` / `.tsx` file with its SPDX header. Run `git add -N <file>` first, then `pnpm --filter @carbon/checks license-headers -- <file>` (the fixer sees tracked files only).
- Wrap every new user-facing string in Lingui (`useLingui().t` or `<Trans>`). This plan adds no new strings.
- Never name a customer, a person or a customer part number in code, comments, docs or tests.
- Write prose in docs, rules and AGENTS.md in STE-80 (`.claude/rules/writing-ste.md`).
- If a step rests on an assumption that turns out false, STOP and report. Do not improvise.

### Shared shell snippet

Tasks 1, 2 and 10 read the local stack's PostgREST with the service-role key. Paste this block first in each shell:

```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
PORT_API=$(grep '^PORT_API=' .env.local | cut -d= -f2-)
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
API="http://localhost:$PORT_API/rest/v1"
AUTH=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY")
```

The URL shape is the one `localClient` builds in `apps/erp/test/database/fixtures/local-supabase.ts`.

---

## Task 0: Check the prerequisites

**Depends on:** none
**Files:** none

**Steps:**
1. Run the Verify block.
2. If `.env.local` is missing, STOP. Ask the user to start the local stack for this worktree (`crbn up`, root script `pnpm dev`). Do not start it yourself.
3. If `node_modules` is missing, STOP. Ask the user to run `pnpm install --frozen-lockfile --config.enable-global-virtual-store=false` in this worktree.
4. If `react-icons` resolves into `Library/pnpm/store`, STOP. Report the global virtual store problem (`.ai/lessons.md` → "A global pnpm virtual store breaks this repo's peer dependencies").
5. If the branch is not `feat/deep-list-search`, STOP and report.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
test -f .env.local && echo env-ok
test -d node_modules && echo deps-ok
readlink apps/erp/node_modules/react-icons
git branch --show-current
# Expected: env-ok, deps-ok, a path that does NOT contain "Library/pnpm/store", feat/deep-list-search
```

**Out of scope:** starting the stack, seeding data, installing packages.

---

## Task 1: Spike — prove a computed field filters on a view

**Depends on:** Task 0
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_deep-list-search-spike.sql` (the CLI picks the timestamp)
- Create or append: `.ai/runs/2026-11-02-deep-list-search.md` (the run log)

The question: does PostgREST filter on a computed field of a VIEW, and does `select=*` leave it out? The PostgREST docs show computed fields on tables only.

**Steps:**
1. Run `pnpm db:migrate:new deep-list-search-spike`.
2. Find the file: `ls packages/database/supabase/migrations/*_deep-list-search-spike.sql`. Expect exactly one file.
3. Replace its content with the SQL below. This is the FINAL purchase order function. Task 2 does not redefine it.
4. Run `pnpm db:migrate`. It applies the file, syncs authz, and regenerates types and swagger.
5. Run the Verify block. Copy its full output into `.ai/runs/2026-11-02-deep-list-search.md` under a heading `## Task 1 spike`.

```sql
-- Deep search on the order and quote lists (.ai/specs/2026-11-02-deep-list-search.md).
-- "searchText" is a PostgREST computed field: a function of the list view's
-- row. PostgREST runs it only when a query filters on it or selects it, so
-- select=* and the detail pages never pay for it. Each value is lower-cased
-- with everything but letters and digits removed (BRK-514 and RAB 514 both
-- read brk514). "|" joins the values, so a match never spans two values.
-- Every party and part-number join is a LEFT JOIN: a row the caller's RLS
-- hides gives NULL and never hides the document. The parameter has no name,
-- so the function is not exposed as /rpc.
CREATE OR REPLACE FUNCTION "searchText"("purchaseOrders")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    regexp_replace(lower($1."purchaseOrderId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower($1."supplierReference"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower($1."jobReadableId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(s."name"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(pod."trackingNumber"), '[^[:alnum:]]+', '', 'g'),
    lines."text"
  )
  FROM (SELECT 1) AS doc
  LEFT JOIN "supplier" s ON s."id" = $1."supplierId"
  LEFT JOIN "purchaseOrderDelivery" pod ON pod."id" = $1."id"
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(
        '|',
        regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(pl."description"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(pl."supplierPartId"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(sp."supplierPartId"), '[^[:alnum:]]+', '', 'g')
      ),
      '|'
    ) AS "text"
    FROM "purchaseOrderLine" pl
    LEFT JOIN "item" i ON i."id" = pl."itemId"
    LEFT JOIN LATERAL (
      SELECT sp."supplierPartId"
      FROM "supplierPart" sp
      WHERE sp."supplierId" = $1."supplierId"
        AND sp."itemId" = pl."itemId"
        AND sp."companyId" = pl."companyId"
      ORDER BY sp."id"
      LIMIT 1
    ) sp ON TRUE
    WHERE pl."purchaseOrderId" = $1."id"
  ) lines ON TRUE;
$$;
```

🛑 If any check in Verify fails, STOP and report. The fallback is a `searchText` column at the end of each view. That fallback needs the user's sign-off. Do not build it.

**Verify:**
```bash
# (paste the Shared shell snippet first)
# 1. select=* leaves the computed field out.
curl -s "${AUTH[@]}" "$API/purchaseOrders?select=*&limit=1" | grep -c searchText
# Expected: 0

# 2. Selecting it by name works.
curl -s "${AUTH[@]}" "$API/purchaseOrders?select=purchaseOrderId,searchText&order=purchaseOrderId.desc&limit=1"
# Expected: [{"purchaseOrderId":"...","searchText":"..."}]  (not an error object)
# If the answer is [] the database has no purchase orders: STOP and ask the user to seed (pnpm db:seed:dev -- --dataset satellite).

# 3. Filtering on it works. TERM is the last value of the first row's searchText.
TERM=$(curl -s "${AUTH[@]}" "$API/purchaseOrders?select=searchText&order=purchaseOrderId.desc&limit=1" \
  | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const v=JSON.parse(s)[0].searchText.split("|").filter(Boolean);console.log(v[v.length-1])})')
echo "TERM=$TERM"
curl -s "${AUTH[@]}" "$API/purchaseOrders?select=purchaseOrderId&searchText=ilike.*$TERM*&limit=5"
# Expected: a non-empty JSON array that contains the purchaseOrderId from check 2

# 4. A word that occurs nowhere returns nothing, and two filters are ANDed.
curl -s "${AUTH[@]}" "$API/purchaseOrders?select=purchaseOrderId&searchText=ilike.*zzqqxxnomatch*"
curl -s "${AUTH[@]}" "$API/purchaseOrders?select=purchaseOrderId&searchText=ilike.*$TERM*&searchText=ilike.*zzqqxxnomatch*"
# Expected: [] and []

# 5. Timing of a filtered page (record it; the spec accepts a slow search).
curl -s -o /dev/null -w "%{time_total}\n" "${AUTH[@]}" "$API/purchaseOrders?select=id&searchText=ilike.*$TERM*&limit=101"
# Expected: a number in seconds. Write it in the run log. Continue at any value.
```

**Out of scope:** the other 7 views, `searchLines`, a user-JWT request (RLS is checked in the browser in Task 10).

---

## Task 2: Add the full search migration

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_deep-list-search.sql`

**Decision: two migrations, not one.** Task 1's file is already applied to the local database. Postgres never runs an applied migration again (`.ai/lessons.md` → "Appending SQL to an already-applied migration silently does nothing"). So this task adds a second file and leaves the spike file as it is. Both files are new on this branch, so production applies both.

Value sources (newest definitions, research §Q5; columns confirmed in `packages/database/src/types.ts`):

| View | Header values | Lines (table, key) | Line values | Order by |
|---|---|---|---|---|
| `supplierQuotes` | `supplierQuoteId`, `supplierReference`, supplier name | `supplierQuoteLine.supplierQuoteId` | item, `description`, `supplierPartId` | `sortOrder` |
| `purchasingRfqs` | `rfqId`, names of `purchasingRfqSupplier` suppliers | `purchasingRfqLine.purchasingRfqId` | item, `description` | `order` |
| `purchaseInvoices` | `invoiceId`, `supplierReference`, supplier name | `purchaseInvoiceLine.invoiceId` | item, `description`, `purchaseOrder.purchaseOrderId`, `supplierPart.supplierPartId` | `sortOrder` |
| `salesOrders` | `salesOrderId`, `customerReference`, customer name, `salesOrderShipment.trackingNumber` | `salesOrderLine.salesOrderId` | item, `description`, `customerPartToItem.customerPartId` | `sortOrder` |
| `quotes` | `quoteId`, `customerReference`, customer name | `quoteLine.quoteId` | item, `description`, `customerPartId` | `sortOrder` |
| `salesRfqs` | `rfqId`, `customerReference`, customer name | `salesRfqLine.salesRfqId` | item, `description`, `customerPartId` | `order` |
| `salesInvoices` | `invoiceId`, `customerReference`, customer name | `salesInvoiceLine.invoiceId` | item, `description`, `salesOrder.salesOrderId`, `customerPartToItem.customerPartId` | `sortOrder` |

"item" means `item.readableIdWithRevision` and `item.name`. Each `searchLines` element is `{ id, itemReadableId, itemName, description, partNumber, quantity, unitOfMeasureCode }`. `quantity` is a number, or an array of numbers for the lines that quote several quantities (`supplierQuoteLine`, `purchasingRfqLine`, `quoteLine`, `salesRfqLine`).

**Steps:**
1. Run `pnpm db:migrate:new deep-list-search`.
2. Find the file: `ls packages/database/supabase/migrations/*_deep-list-search.sql`. Expect exactly one file (the spike file ends in `-spike.sql`).
3. Replace its content with the SQL below, as it is.
4. Run `pnpm db:migrate`.
5. Run the Verify block.
6. Append the Verify output to `.ai/runs/2026-11-02-deep-list-search.md` under `## Task 2`.

```sql
-- Deep search on the order and quote lists (.ai/specs/2026-11-02-deep-list-search.md).
-- The purchase order "searchText" is in the previous migration
-- (deep-list-search-spike). This file adds "searchText" for the other 7 list
-- views, "searchLines" for all 8, and drops the view Inventory → Receiving read.
-- Same rules as there: computed fields (not in select=*), values lower-cased
-- with everything but letters and digits removed, "|" between values, LEFT
-- JOIN for every party and part-number join, STABLE, SECURITY INVOKER, and an
-- unnamed parameter so the function is not exposed as /rpc.

-- ---------------------------------------------------------------------------
-- searchText
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "searchText"("supplierQuotes")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    regexp_replace(lower($1."supplierQuoteId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower($1."supplierReference"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(s."name"), '[^[:alnum:]]+', '', 'g'),
    lines."text"
  )
  FROM (SELECT 1) AS doc
  LEFT JOIN "supplier" s ON s."id" = $1."supplierId"
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(
        '|',
        regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(sq."description"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(sq."supplierPartId"), '[^[:alnum:]]+', '', 'g')
      ),
      '|'
    ) AS "text"
    FROM "supplierQuoteLine" sq
    LEFT JOIN "item" i ON i."id" = sq."itemId"
    WHERE sq."supplierQuoteId" = $1."id"
  ) lines ON TRUE;
$$;

CREATE OR REPLACE FUNCTION "searchText"("purchasingRfqs")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    regexp_replace(lower($1."rfqId"), '[^[:alnum:]]+', '', 'g'),
    suppliers."text",
    lines."text"
  )
  FROM (SELECT 1) AS doc
  LEFT JOIN LATERAL (
    SELECT string_agg(
      regexp_replace(lower(s."name"), '[^[:alnum:]]+', '', 'g'),
      '|'
    ) AS "text"
    FROM "purchasingRfqSupplier" prs
    LEFT JOIN "supplier" s ON s."id" = prs."supplierId"
    WHERE prs."purchasingRfqId" = $1."id"
  ) suppliers ON TRUE
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(
        '|',
        regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(rl."description"), '[^[:alnum:]]+', '', 'g')
      ),
      '|'
    ) AS "text"
    FROM "purchasingRfqLine" rl
    LEFT JOIN "item" i ON i."id" = rl."itemId"
    WHERE rl."purchasingRfqId" = $1."id"
  ) lines ON TRUE;
$$;

CREATE OR REPLACE FUNCTION "searchText"("purchaseInvoices")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    regexp_replace(lower($1."invoiceId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower($1."supplierReference"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(s."name"), '[^[:alnum:]]+', '', 'g'),
    lines."text"
  )
  FROM (SELECT 1) AS doc
  LEFT JOIN "supplier" s ON s."id" = $1."supplierId"
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(
        '|',
        regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(il."description"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(po."purchaseOrderId"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(sp."supplierPartId"), '[^[:alnum:]]+', '', 'g')
      ),
      '|'
    ) AS "text"
    FROM "purchaseInvoiceLine" il
    LEFT JOIN "item" i ON i."id" = il."itemId"
    LEFT JOIN "purchaseOrder" po ON po."id" = il."purchaseOrderId"
    LEFT JOIN LATERAL (
      SELECT sp."supplierPartId"
      FROM "supplierPart" sp
      WHERE sp."supplierId" = $1."supplierId"
        AND sp."itemId" = il."itemId"
        AND sp."companyId" = il."companyId"
      ORDER BY sp."id"
      LIMIT 1
    ) sp ON TRUE
    WHERE il."invoiceId" = $1."id"
  ) lines ON TRUE;
$$;

CREATE OR REPLACE FUNCTION "searchText"("salesOrders")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    regexp_replace(lower($1."salesOrderId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower($1."customerReference"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(c."name"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(sos."trackingNumber"), '[^[:alnum:]]+', '', 'g'),
    lines."text"
  )
  FROM (SELECT 1) AS doc
  LEFT JOIN "customer" c ON c."id" = $1."customerId"
  LEFT JOIN "salesOrderShipment" sos ON sos."id" = $1."id"
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(
        '|',
        regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(sol."description"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(cpi."customerPartId"), '[^[:alnum:]]+', '', 'g')
      ),
      '|'
    ) AS "text"
    FROM "salesOrderLine" sol
    LEFT JOIN "item" i ON i."id" = sol."itemId"
    LEFT JOIN LATERAL (
      SELECT cpi."customerPartId"
      FROM "customerPartToItem" cpi
      WHERE cpi."customerId" = $1."customerId"
        AND cpi."itemId" = sol."itemId"
        AND cpi."companyId" = sol."companyId"
      ORDER BY cpi."id"
      LIMIT 1
    ) cpi ON TRUE
    WHERE sol."salesOrderId" = $1."id"
  ) lines ON TRUE;
$$;

CREATE OR REPLACE FUNCTION "searchText"("quotes")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    regexp_replace(lower($1."quoteId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower($1."customerReference"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(c."name"), '[^[:alnum:]]+', '', 'g'),
    lines."text"
  )
  FROM (SELECT 1) AS doc
  LEFT JOIN "customer" c ON c."id" = $1."customerId"
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(
        '|',
        regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(ql."description"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(ql."customerPartId"), '[^[:alnum:]]+', '', 'g')
      ),
      '|'
    ) AS "text"
    FROM "quoteLine" ql
    LEFT JOIN "item" i ON i."id" = ql."itemId"
    WHERE ql."quoteId" = $1."id"
  ) lines ON TRUE;
$$;

CREATE OR REPLACE FUNCTION "searchText"("salesRfqs")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    regexp_replace(lower($1."rfqId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower($1."customerReference"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(c."name"), '[^[:alnum:]]+', '', 'g'),
    lines."text"
  )
  FROM (SELECT 1) AS doc
  LEFT JOIN "customer" c ON c."id" = $1."customerId"
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(
        '|',
        regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(rl."description"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(rl."customerPartId"), '[^[:alnum:]]+', '', 'g')
      ),
      '|'
    ) AS "text"
    FROM "salesRfqLine" rl
    LEFT JOIN "item" i ON i."id" = rl."itemId"
    WHERE rl."salesRfqId" = $1."id"
  ) lines ON TRUE;
$$;

CREATE OR REPLACE FUNCTION "searchText"("salesInvoices")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    regexp_replace(lower($1."invoiceId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower($1."customerReference"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(c."name"), '[^[:alnum:]]+', '', 'g'),
    lines."text"
  )
  FROM (SELECT 1) AS doc
  LEFT JOIN "customer" c ON c."id" = $1."customerId"
  LEFT JOIN LATERAL (
    SELECT string_agg(
      concat_ws(
        '|',
        regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(il."description"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(so."salesOrderId"), '[^[:alnum:]]+', '', 'g'),
        regexp_replace(lower(cpi."customerPartId"), '[^[:alnum:]]+', '', 'g')
      ),
      '|'
    ) AS "text"
    FROM "salesInvoiceLine" il
    LEFT JOIN "item" i ON i."id" = il."itemId"
    LEFT JOIN "salesOrder" so ON so."id" = il."salesOrderId"
    LEFT JOIN LATERAL (
      SELECT cpi."customerPartId"
      FROM "customerPartToItem" cpi
      WHERE cpi."customerId" = $1."customerId"
        AND cpi."itemId" = il."itemId"
        AND cpi."companyId" = il."companyId"
      ORDER BY cpi."id"
      LIMIT 1
    ) cpi ON TRUE
    WHERE il."invoiceId" = $1."id"
  ) lines ON TRUE;
$$;

-- ---------------------------------------------------------------------------
-- searchLines: the document's lines as the list's expanded row shows them.
-- The service selects it only while a search is active.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "searchLines"("purchaseOrders")
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', pl."id",
        'itemReadableId', i."readableIdWithRevision",
        'itemName', i."name",
        'description', pl."description",
        'partNumber', COALESCE(NULLIF(pl."supplierPartId", ''), sp."supplierPartId"),
        'quantity', pl."purchaseQuantity",
        'unitOfMeasureCode', pl."purchaseUnitOfMeasureCode"
      )
      ORDER BY pl."sortOrder", pl."id"
    ),
    '[]'::jsonb
  )
  FROM "purchaseOrderLine" pl
  LEFT JOIN "item" i ON i."id" = pl."itemId"
  LEFT JOIN LATERAL (
    SELECT sp."supplierPartId"
    FROM "supplierPart" sp
    WHERE sp."supplierId" = $1."supplierId"
      AND sp."itemId" = pl."itemId"
      AND sp."companyId" = pl."companyId"
    ORDER BY sp."id"
    LIMIT 1
  ) sp ON TRUE
  WHERE pl."purchaseOrderId" = $1."id";
$$;

CREATE OR REPLACE FUNCTION "searchLines"("supplierQuotes")
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sq."id",
        'itemReadableId', i."readableIdWithRevision",
        'itemName', i."name",
        'description', sq."description",
        'partNumber', sq."supplierPartId",
        'quantity', to_jsonb(sq."quantity"),
        'unitOfMeasureCode', sq."purchaseUnitOfMeasureCode"
      )
      ORDER BY sq."sortOrder", sq."id"
    ),
    '[]'::jsonb
  )
  FROM "supplierQuoteLine" sq
  LEFT JOIN "item" i ON i."id" = sq."itemId"
  WHERE sq."supplierQuoteId" = $1."id";
$$;

CREATE OR REPLACE FUNCTION "searchLines"("purchasingRfqs")
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rl."id",
        'itemReadableId', i."readableIdWithRevision",
        'itemName', i."name",
        'description', rl."description",
        'partNumber', NULL,
        'quantity', to_jsonb(rl."quantity"),
        'unitOfMeasureCode', rl."purchaseUnitOfMeasureCode"
      )
      ORDER BY rl."order", rl."id"
    ),
    '[]'::jsonb
  )
  FROM "purchasingRfqLine" rl
  LEFT JOIN "item" i ON i."id" = rl."itemId"
  WHERE rl."purchasingRfqId" = $1."id";
$$;

CREATE OR REPLACE FUNCTION "searchLines"("purchaseInvoices")
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', il."id",
        'itemReadableId', i."readableIdWithRevision",
        'itemName', i."name",
        'description', il."description",
        'partNumber', sp."supplierPartId",
        'quantity', il."quantity",
        'unitOfMeasureCode', il."purchaseUnitOfMeasureCode"
      )
      ORDER BY il."sortOrder", il."id"
    ),
    '[]'::jsonb
  )
  FROM "purchaseInvoiceLine" il
  LEFT JOIN "item" i ON i."id" = il."itemId"
  LEFT JOIN LATERAL (
    SELECT sp."supplierPartId"
    FROM "supplierPart" sp
    WHERE sp."supplierId" = $1."supplierId"
      AND sp."itemId" = il."itemId"
      AND sp."companyId" = il."companyId"
    ORDER BY sp."id"
    LIMIT 1
  ) sp ON TRUE
  WHERE il."invoiceId" = $1."id";
$$;

CREATE OR REPLACE FUNCTION "searchLines"("salesOrders")
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sol."id",
        'itemReadableId', i."readableIdWithRevision",
        'itemName', i."name",
        'description', sol."description",
        'partNumber', cpi."customerPartId",
        'quantity', sol."saleQuantity",
        'unitOfMeasureCode', sol."unitOfMeasureCode"
      )
      ORDER BY sol."sortOrder", sol."id"
    ),
    '[]'::jsonb
  )
  FROM "salesOrderLine" sol
  LEFT JOIN "item" i ON i."id" = sol."itemId"
  LEFT JOIN LATERAL (
    SELECT cpi."customerPartId"
    FROM "customerPartToItem" cpi
    WHERE cpi."customerId" = $1."customerId"
      AND cpi."itemId" = sol."itemId"
      AND cpi."companyId" = sol."companyId"
    ORDER BY cpi."id"
    LIMIT 1
  ) cpi ON TRUE
  WHERE sol."salesOrderId" = $1."id";
$$;

CREATE OR REPLACE FUNCTION "searchLines"("quotes")
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ql."id",
        'itemReadableId', i."readableIdWithRevision",
        'itemName', i."name",
        'description', ql."description",
        'partNumber', ql."customerPartId",
        'quantity', to_jsonb(ql."quantity"),
        'unitOfMeasureCode', ql."unitOfMeasureCode"
      )
      ORDER BY ql."sortOrder", ql."id"
    ),
    '[]'::jsonb
  )
  FROM "quoteLine" ql
  LEFT JOIN "item" i ON i."id" = ql."itemId"
  WHERE ql."quoteId" = $1."id";
$$;

CREATE OR REPLACE FUNCTION "searchLines"("salesRfqs")
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rl."id",
        'itemReadableId', i."readableIdWithRevision",
        'itemName', i."name",
        'description', rl."description",
        'partNumber', rl."customerPartId",
        'quantity', to_jsonb(rl."quantity"),
        'unitOfMeasureCode', rl."unitOfMeasureCode"
      )
      ORDER BY rl."order", rl."id"
    ),
    '[]'::jsonb
  )
  FROM "salesRfqLine" rl
  LEFT JOIN "item" i ON i."id" = rl."itemId"
  WHERE rl."salesRfqId" = $1."id";
$$;

CREATE OR REPLACE FUNCTION "searchLines"("salesInvoices")
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', il."id",
        'itemReadableId', i."readableIdWithRevision",
        'itemName', i."name",
        'description', il."description",
        'partNumber', cpi."customerPartId",
        'quantity', il."quantity",
        'unitOfMeasureCode', il."unitOfMeasureCode"
      )
      ORDER BY il."sortOrder", il."id"
    ),
    '[]'::jsonb
  )
  FROM "salesInvoiceLine" il
  LEFT JOIN "item" i ON i."id" = il."itemId"
  LEFT JOIN LATERAL (
    SELECT cpi."customerPartId"
    FROM "customerPartToItem" cpi
    WHERE cpi."customerId" = $1."customerId"
      AND cpi."itemId" = il."itemId"
      AND cpi."companyId" = il."companyId"
    ORDER BY cpi."id"
    LIMIT 1
  ) cpi ON TRUE
  WHERE il."invoiceId" = $1."id";
$$;

-- ---------------------------------------------------------------------------
-- Inventory → Receiving is removed: the Purchase Orders list finds the same
-- orders. Nothing else reads this view.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS "purchaseOrderLinesToReceive";
```

🛑 If `pnpm db:migrate` reports an error that names a column (for example `column ... does not exist`), STOP and report the error. Do not guess another column name.

**Verify:**
```bash
# (paste the Shared shell snippet first)
for v in purchaseOrders supplierQuotes purchasingRfqs purchaseInvoices salesOrders quotes salesRfqs salesInvoices; do
  echo "== $v"
  curl -s "${AUTH[@]}" "$API/$v?select=*&limit=1" | grep -c -E 'searchText|searchLines'
  curl -s "${AUTH[@]}" "$API/$v?select=id,searchText,searchLines&limit=1" | head -c 600; echo
done
# Expected per view: the line "0", then [] or [{"id":"...","searchText":...,"searchLines":[...]}].
# Not expected: an object with "code" (an error).

curl -s "${AUTH[@]}" "$API/purchaseOrderLinesToReceive?limit=1" | grep -o PGRST205
# Expected: PGRST205 (the view is gone)

pnpm --filter @carbon/checks clobbers
# Expected: exit 0
```

**Out of scope:** indexes, a stored column, any change to the 8 views themselves.

---

## Task 3: Regenerate the database types

**Depends on:** Task 2
**Files:**
- Modify (generated, never by hand): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`

`pnpm db:migrate` already regenerates both files when it applies a migration. This task runs the generator once more on purpose and records what it emits for the computed fields.

How the services type the new field: they do not rely on the generated types. `withSearchLines` (Task 4) casts the select string back to the list's own literal type, so the row type of each list stays as it is today. The table reads `searchLines` through `matchingSearchLines(row: object, …)`, which checks the value at runtime. This works whether or not `supabase gen types` emits the computed fields. (`@supabase/postgrest-js` 2.117.2 drops computed fields from `select=*` types when the generator lists them.)

**Steps:**
1. Run `pnpm run generate:types`.
2. Run the Verify block.
3. Write the two `grep -c` results in `.ai/runs/2026-11-02-deep-list-search.md` under `## Task 3`.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
pnpm run generate:types
# Expected: "Database types refreshed in both output files."
grep -c "purchaseOrderLinesToReceive" packages/database/src/types.ts
# Expected: 0
grep -c "searchLines" packages/database/src/types.ts
# Expected: any number (0 or more). Record it.
git diff --stat -- packages/database/src/types.ts packages/database/src/swagger-docs-schema.ts
# Expected: both files changed
```

**Out of scope:** hand edits of `types.ts`.

---

## Task 4: Move the search helpers to `~/utils/search`

**Depends on:** Task 0 (independent of Tasks 1–3)
**Files:**
- Create: `apps/erp/app/utils/search.ts`
- Create: `apps/erp/app/utils/search.test.ts`
- Modify: `apps/erp/app/modules/inventory/inventory.utils.ts` (remove `NOT_ALPHANUMERIC`, `receivingSearchTerms`, `receivingSearchMatches`, lines 63–125)
- Modify: `apps/erp/app/modules/inventory/inventory.utils.test.ts` (remove the two imports at lines 11–12 and the two `describe` blocks with their comment at lines 81–116)
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` (import at line 237, call at line 988)
- Modify: `apps/erp/app/modules/inventory/ui/Receiving/ReceivingTable.tsx` (import at lines 32–35, calls at lines 111 and 144)
- Copy from (precedent): `apps/erp/app/utils/cursor.ts` + `cursor.test.ts` (a browser-safe util with its test beside it)

`apps/erp/app/utils/` holds browser-safe helpers that every module imports (`cursor.ts`, `query.ts`). `string.ts` imports `@carbon/logger`, so a new file is cleaner.

Name note: `~/components/Highlight.tsx` already exports a different `searchMatches(text, search)` (one phrase, used by 3 tables). The new `searchMatches(text, terms)` keeps the spec's name. Typecheck catches a wrong import, because one takes a `string` and the other a `string[]`. Import the new one only from `~/utils/search`.

**Steps:**
1. Create `apps/erp/app/utils/search.ts` with this content:

```ts
const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/**
 * The words of a list search, normalized as the `searchText` computed field
 * stores its values: lower-cased, with everything but letters and digits
 * removed. A packing slip prints BRK-514 where Carbon holds BRK514, and both
 * read brk514. Every word must match.
 *
 * JavaScript's `\p{L}\p{N}` and Postgres's `[[:alnum:]]` can disagree on a
 * non-ASCII letter, depending on the database locale.
 */
export function searchTerms(search: string | null | undefined): string[] {
  if (!search) return [];
  return search
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(NOT_ALPHANUMERIC, ""))
    .filter(Boolean);
}

/**
 * Where the search terms occur in `text`, matched the way the search matches
 * (case, spaces and punctuation ignored): sorted, merged `[start, end)` ranges
 * of `text`, so a highlight covers BRK-514 for the term brk514.
 */
export function searchMatches(
  text: string,
  terms: string[]
): [number, number][] {
  if (!text || terms.length === 0) return [];

  // The normalized text, and for each of its characters the index in `text`
  // it came from.
  let normalized = "";
  const source: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const lower = text[i]!.toLowerCase().replace(NOT_ALPHANUMERIC, "");
    for (const char of lower) {
      normalized += char;
      source.push(i);
    }
  }

  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = normalized.indexOf(term);
    while (from !== -1) {
      const end = from + term.length;
      ranges.push([source[from]!, source[end - 1]! + 1]);
      from = normalized.indexOf(term, end);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

/** One line of a document, as the `searchLines` computed field returns it. */
export type SearchLine = {
  id: string;
  itemReadableId: string | null;
  itemName: string | null;
  description: string | null;
  partNumber: string | null;
  /** One quantity, or one per price break on a quote or an RFQ line. */
  quantity: number | number[] | null;
  unitOfMeasureCode: string | null;
};

/**
 * A list's select with `searchLines` added while the search has a word, so a
 * list without a search reads exactly what it read before. The cast keeps the
 * list's literal select type: the row type does not change, and the table
 * reads the lines through `matchingSearchLines`.
 */
export function withSearchLines<Columns extends string>(
  columns: Columns,
  search: string | null | undefined
): Columns {
  return (
    searchTerms(search).length > 0 ? `${columns},searchLines` : columns
  ) as Columns;
}

/**
 * The lines of a list row (its `searchLines`) that a search word matched, in
 * line order. A row searched only by a header value has none.
 */
export function matchingSearchLines(
  row: object,
  terms: string[]
): SearchLine[] {
  if (terms.length === 0) return [];
  const lines = (row as { searchLines?: unknown }).searchLines;
  if (!Array.isArray(lines)) return [];
  return (lines as SearchLine[]).filter((line) =>
    [line.itemReadableId, line.itemName, line.description, line.partNumber].some(
      (value) => !!value && searchMatches(value, terms).length > 0
    )
  );
}
```

2. Create `apps/erp/app/utils/search.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import {
  matchingSearchLines,
  type SearchLine,
  searchMatches,
  searchTerms,
  withSearchLines
} from "./search";

// The list search filters on the normalized `searchText` and highlights with
// the same rule, so what matched is what is marked.
describe("searchTerms", () => {
  it("ignores case, spaces and punctuation inside a word", () => {
    expect(searchTerms("BRK-514")).toEqual(["brk514"]);
    expect(searchTerms("  Orbital   P-0000042.01 ")).toEqual([
      "orbital",
      "p000004201"
    ]);
  });

  it("drops words that are only punctuation", () => {
    expect(searchTerms("- / .")).toEqual([]);
    expect(searchTerms(null)).toEqual([]);
  });
});

describe("searchMatches", () => {
  it("marks the original characters a normalized term matched", () => {
    expect(searchMatches("BRK-514", ["brk514"])).toEqual([[0, 7]]);
    expect(searchMatches("TI  -200", ["ti200"])).toEqual([[0, 8]]);
  });

  it("merges overlapping matches of several terms", () => {
    expect(searchMatches("BEARING, 7000", ["bear", "ring", "7000"])).toEqual([
      [0, 7],
      [9, 13]
    ]);
  });

  it("marks nothing without a match", () => {
    expect(searchMatches("VLV708", ["7000"])).toEqual([]);
  });
});

// A list without a search must read what it read before the feature.
describe("withSearchLines", () => {
  it("adds searchLines only while the search has a word", () => {
    expect(withSearchLines("*", null)).toBe("*");
    expect(withSearchLines("*", " - / ")).toBe("*");
    expect(withSearchLines("*", "brk-514")).toBe("*,searchLines");
    expect(withSearchLines("id,name", "rab")).toBe("id,name,searchLines");
  });
});

const line = (overrides: Partial<SearchLine>): SearchLine => ({
  id: "line",
  itemReadableId: null,
  itemName: null,
  description: null,
  partNumber: null,
  quantity: 1,
  unitOfMeasureCode: "EA",
  ...overrides
});

describe("matchingSearchLines", () => {
  it("keeps the lines where any word matches a value, punctuation ignored", () => {
    const row = {
      searchLines: [
        line({ id: "a", partNumber: "BRK-514" }),
        line({ id: "b", itemName: "Bearing" }),
        line({ id: "c", description: "Spacer" })
      ]
    };
    expect(
      matchingSearchLines(row, ["brk514", "bear"]).map((match) => match.id)
    ).toEqual(["a", "b"]);
  });

  it("matches nothing without words or without lines", () => {
    const row = { searchLines: [line({ itemName: "Bearing" })] };
    expect(matchingSearchLines(row, [])).toEqual([]);
    expect(matchingSearchLines({ id: "po" }, ["bear"])).toEqual([]);
  });
});
```

3. Run `git add -N apps/erp/app/utils/search.ts apps/erp/app/utils/search.test.ts`.
4. Run `pnpm --filter @carbon/checks license-headers -- apps/erp/app/utils/search.ts apps/erp/app/utils/search.test.ts`.
5. In `inventory.utils.ts`, delete `const NOT_ALPHANUMERIC …` and the functions `receivingSearchTerms` and `receivingSearchMatches` with their doc comments (lines 63–125).
6. In `inventory.utils.test.ts`, delete `receivingSearchMatches,` and `receivingSearchTerms,` from the import list.
7. In `inventory.utils.test.ts`, delete the comment `// The Receiving search filters …` and the `describe("receivingSearchTerms", …)` and `describe("receivingSearchMatches", …)` blocks.
8. In `inventory.service.ts`, delete `receivingSearchTerms,` from the `./inventory.utils` import (line 237).
9. In `inventory.service.ts`, add `import { searchTerms } from "~/utils/search";` after the `~/utils/query` imports.
10. In `inventory.service.ts`, change `receivingSearchTerms(args.search)` to `searchTerms(args.search)` (line 988).
11. In `ReceivingTable.tsx`, replace the import of `receivingSearchMatches, receivingSearchTerms` from `~/modules/inventory/inventory.utils` with `import { searchMatches, searchTerms } from "~/utils/search";`.
12. In `ReceivingTable.tsx`, rename the two calls: `receivingSearchMatches(` → `searchMatches(`, `receivingSearchTerms(` → `searchTerms(`. (Task 7 deletes this file. This step only keeps the tree compiling between tasks.)

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
head -1 apps/erp/app/utils/search.ts apps/erp/app/utils/search.test.ts
# Expected: "// SPDX-License-Identifier: AGPL-3.0-only" for both
grep -rn "receivingSearch" apps/erp/app
# Expected: no output
pnpm --filter erp exec vitest run app/utils/search.test.ts app/modules/inventory/inventory.utils.test.ts
# Expected: all tests pass, 0 failed
pnpm exec biome check apps/erp/app/utils/search.ts apps/erp/app/utils/search.test.ts apps/erp/app/modules/inventory/inventory.utils.ts apps/erp/app/modules/inventory/inventory.utils.test.ts apps/erp/app/modules/inventory/inventory.service.ts apps/erp/app/modules/inventory/ui/Receiving/ReceivingTable.tsx
# Expected: no errors
```

**Out of scope:** the `searchMatches` in `~/components/Highlight.tsx` and its 3 callers.

---

## Task 5a: Search lines in the purchasing services

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — `getPurchaseOrders` (line ~596), `getSupplierQuotes` (line ~1163), `getPurchasingRFQs` (line ~3224)
- Copy from (precedent): the search loop in `getPurchaseOrderLinesToReceive`, `apps/erp/app/modules/inventory/inventory.service.ts:988-990`

How the result reaches every caller (no change needed there):
- The loader and the cursor pages call the service through `searchList` (`apps/erp/app/utils/list-registry/purchasing.server.ts:32-52`), which passes `search`.
- The background CSV export runs the same service. It writes only the columns the browser sends (`table-csv-export.md` → Background path), so `searchLines` never reaches the CSV.
- The MCP / API operations (`purchasing.server.ts:4416`, `:4818`, `:6225`) call the same building block. Their input schema does not change, so the MCP manifest digest does not change.

**Steps:**
1. Add `import { searchTerms, withSearchLines } from "~/utils/search";` after the `~/utils/query` imports (line 137).
2. In `getPurchaseOrders`, change `.select(PURCHASE_ORDERS_LIST_COLUMNS, {` to `.select(withSearchLines(PURCHASE_ORDERS_LIST_COLUMNS, args.search), {`.
3. In `getPurchaseOrders`, replace this block:
   ```ts
   if (args.search) {
     query = query.or(
       searchFilter(["purchaseOrderId", "supplierReference"], args.search)
     );
   }
   ```
   with:
   ```ts
   // Every word must occur in the order or one of its lines (`searchText`).
   for (const term of searchTerms(args.search)) {
     query = query.ilike("searchText", `%${term}%`);
   }
   ```
4. In `getSupplierQuotes`, change `.select("*", { count: listCount(args) })` to `.select(withSearchLines("*", args.search), { count: listCount(args) })`.
5. In `getSupplierQuotes`, replace the `if (args.search) { query = query.or(searchFilter(["supplierQuoteId", "supplierReference"], args.search)); }` block with the loop from step 3. Change the comment word "order" to "quote".
6. In `getPurchasingRFQs`, change `.select("*", { count: listCount(args) })` to `.select(withSearchLines("*", args.search), { count: listCount(args) })`.
7. In `getPurchasingRFQs`, replace `if (args.search) { query = query.ilike("rfqId", \`%${args.search}%\`); }` with the loop from step 3. Change the comment word "order" to "RFQ".
8. Keep the `searchFilter` import: other functions in this file still use it.

The terms hold only letters and digits, so they never contain `%` or `_` and need no `escapeLike`.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
grep -c 'withSearchLines(' apps/erp/app/modules/purchasing/purchasing.service.ts
# Expected: 3
grep -c '"searchText"' apps/erp/app/modules/purchasing/purchasing.service.ts
# Expected: 3
pnpm exec biome check apps/erp/app/modules/purchasing/purchasing.service.ts
# Expected: no errors
```

**Out of scope:** the other purchasing lists (supplier returns, suppliers, leases), the select constants, the paging constants.

---

## Task 5b: Search lines in the sales services

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `getQuotes` (line ~1493), `getSalesOrders` (line ~1952), `getSalesRFQs` (line ~2168)
- Copy from (precedent): Task 5a, steps 2–3 (the same two edits, written out below for each function)

**Steps:**
1. Add `import { searchTerms, withSearchLines } from "~/utils/search";` after the `~/utils/query` imports (line 164).
2. In `getQuotes`, change `.select(QUOTES_LIST_COLUMNS, {` to `.select(withSearchLines(QUOTES_LIST_COLUMNS, args.search), {`.
3. In `getQuotes`, replace the `if (args.search) { query = query.or(searchFilter(["quoteId", "customerReference"], args.search)); }` block with:
   ```ts
   // Every word must occur in the quote or one of its lines (`searchText`).
   for (const term of searchTerms(args.search)) {
     query = query.ilike("searchText", `%${term}%`);
   }
   ```
4. In `getSalesOrders`, change `.select(SALES_ORDERS_LIST_COLUMNS, {` to `.select(withSearchLines(SALES_ORDERS_LIST_COLUMNS, args.search), {`.
5. In `getSalesOrders`, replace the `if (args.search) { query = query.or(searchFilter(["salesOrderId", "customerReference"], args.search)); }` block with the loop from step 3, comment word "order".
6. In `getSalesRFQs`, change `.select("*", { count: listCount(args) })` to `.select(withSearchLines("*", args.search), { count: listCount(args) })`.
7. In `getSalesRFQs`, replace `if (args.search) { query = query.or(searchFilter(["rfqId", "customerReference"], args.search)); }` with the loop from step 3, comment word "RFQ".
8. Keep the `searchFilter` import: other functions in this file still use it.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
grep -c 'withSearchLines(' apps/erp/app/modules/sales/sales.service.ts
# Expected: 3
grep -c '"searchText"' apps/erp/app/modules/sales/sales.service.ts
# Expected: 3
pnpm exec biome check apps/erp/app/modules/sales/sales.service.ts
# Expected: no errors
```

**Out of scope:** sales return orders, customers, the select constants.

---

## Task 5c: Search lines in the invoicing services

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — `getPurchaseInvoices` (line ~572), `getSalesInvoices` (line ~660)

**Steps:**
1. Add `import { searchTerms, withSearchLines } from "~/utils/search";` after the `~/utils/query` imports (line 217).
2. In `getPurchaseInvoices`, change `.select(PURCHASE_INVOICES_LIST_COLUMNS, {` to `.select(withSearchLines(PURCHASE_INVOICES_LIST_COLUMNS, args.search), {`.
3. In `getPurchaseInvoices`, replace `if (args.search) { query = query.ilike("invoiceId", \`%${args.search}%\`); }` with:
   ```ts
   // Every word must occur in the invoice or one of its lines (`searchText`).
   for (const term of searchTerms(args.search)) {
     query = query.ilike("searchText", `%${term}%`);
   }
   ```
4. In `getSalesInvoices`, change `.select(SALES_INVOICES_LIST_COLUMNS, {` to `.select(withSearchLines(SALES_INVOICES_LIST_COLUMNS, args.search), {`.
5. In `getSalesInvoices`, replace `if (args.search) { query = query.ilike("invoiceId", \`%${args.search}%\`); }` with the loop from step 3.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
grep -c 'withSearchLines(' apps/erp/app/modules/invoicing/invoicing.service.ts
# Expected: 2
grep -c '"searchText"' apps/erp/app/modules/invoicing/invoicing.service.ts
# Expected: 2
pnpm exec biome check apps/erp/app/modules/invoicing/invoicing.service.ts
# Expected: no errors
```

**Out of scope:** credit memos, supplier credits, payments.

---

## Task 6: Add the matched-lines component and pin the Expand column

**Depends on:** Task 4
**Files:**
- Create: `apps/erp/app/components/MatchingLines.tsx`
- Modify: `apps/erp/app/components/Table/Table.tsx` (lines 529–531 and 609)
- Copy from (precedent): `renderExpandedRow` in `apps/erp/app/modules/inventory/ui/Receiving/ReceivingTable.tsx:293-367` (layout and classes) and `Highlight` in `apps/erp/app/components/Highlight.tsx`

Why the Table change: the 8 tables pass `renderExpandedRow` only while a search is active, so with no search the list has no Expand column, as today. The Table computes its default pins once, at mount (`getDefaultColumnPinning`, `Table.tsx:514-531`), and a saved view stores its own pins. So an Expand column that appears later would not be pinned first. The fix keeps "Expand" first in the left pins whenever `renderExpandedRow` is set. It changes no saved view.

**Steps:**
1. Create `apps/erp/app/components/MatchingLines.tsx` with this content:

```tsx
import { HStack } from "@carbon/react";
import { useQuantityFormatter } from "~/hooks";
import {
  matchingSearchLines,
  type SearchLine,
  searchMatches
} from "~/utils/search";
import { Highlight } from "./Highlight";

/**
 * The lines of a list row that the search matched, each match marked: the
 * expanded row of a list searched by line values (`searchLines`).
 */
export function MatchingLines({
  row,
  terms
}: {
  row: object;
  terms: string[];
}) {
  const formatQuantity = useQuantityFormatter();
  const quantityOf = (quantity: SearchLine["quantity"]) => {
    if (quantity === null) return "";
    if (Array.isArray(quantity)) {
      return quantity.map((value) => formatQuantity(value)).join(" / ");
    }
    return formatQuantity(quantity);
  };

  return (
    <div className="pl-[52px] pr-4">
      {matchingSearchLines(row, terms).map((line) => {
        const name = line.itemName ?? line.description;
        return (
          <div key={line.id} className="flex gap-3 py-2 text-sm">
            <div
              aria-hidden
              className="w-5 shrink-0 border-l border-border -my-2"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0">
              <HStack spacing={2} className="min-w-0">
                {line.itemReadableId && (
                  <span className="whitespace-nowrap font-medium">
                    <Highlight
                      text={line.itemReadableId}
                      ranges={searchMatches(line.itemReadableId, terms)}
                    />
                  </span>
                )}
                {line.partNumber && (
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    <Highlight
                      text={line.partNumber}
                      ranges={searchMatches(line.partNumber, terms)}
                    />
                  </span>
                )}
              </HStack>
              <span className="truncate text-xs text-muted-foreground">
                {name && (
                  <Highlight text={name} ranges={searchMatches(name, terms)} />
                )}
                {line.description && line.description !== name && (
                  <>
                    {" · "}
                    <Highlight
                      text={line.description}
                      ranges={searchMatches(line.description, terms)}
                    />
                  </>
                )}
              </span>
            </div>
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              {quantityOf(line.quantity)} {line.unitOfMeasureCode}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

2. Run `git add -N apps/erp/app/components/MatchingLines.tsx`.
3. Run `pnpm --filter @carbon/checks license-headers -- apps/erp/app/components/MatchingLines.tsx`.
4. In `Table.tsx`, directly after the `useState` of `columnPinning` (ends at line 531), add:

```tsx
  // "Expand" stays first on the left whenever rows can expand: a list can
  // turn expansion on after mount (a search), and a saved view from before
  // that does not name the column.
  const effectiveColumnPinning = useMemo<ColumnPinningState>(() => {
    const left = (columnPinning.left ?? []).filter((id) => id !== "Expand");
    return {
      ...columnPinning,
      left: renderExpandedRow ? ["Expand", ...left] : left
    };
  }, [columnPinning, renderExpandedRow]);
```

5. In `Table.tsx`, in the `useReactTable({ … state: { … } })` call (line 609), change `columnPinning,` to `columnPinning: effectiveColumnPinning,`.
6. Do not change the `columnPinning={columnPinning}` prop on `<TableHeader>` (line 1413). Saved views keep storing the user's own pins.

If `useMemo` or `ColumnPinningState` is not already imported in `Table.tsx`, STOP and report (both are imported today: `ColumnPinningState` is used at line 529).

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
head -1 apps/erp/app/components/MatchingLines.tsx
# Expected: // SPDX-License-Identifier: AGPL-3.0-only
grep -n "effectiveColumnPinning" apps/erp/app/components/Table/Table.tsx
# Expected: 2 lines (the useMemo and the useReactTable state)
pnpm exec biome check apps/erp/app/components/MatchingLines.tsx apps/erp/app/components/Table/Table.tsx
# Expected: no errors
```

**Out of scope:** item thumbnails or links in the matched lines, the other tables that already use `renderExpandedRow`.

---

## Task 6b: Show matched lines in the 8 list tables

**Depends on:** Tasks 5a, 5b, 5c, 6
**Files:**

| # | Modify | Row type | `react` import today | `~/hooks` import today |
|---|---|---|---|---|
| 1 | `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx` | `PurchaseOrderListItem` | `memo, useCallback, useMemo, useState` | `useCurrencyFormatter, usePermissions, useRealtime` |
| 2 | `apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuotesTable.tsx` | `SupplierQuote` | `memo, useMemo, useState` | `usePermissions` |
| 3 | `apps/erp/app/modules/purchasing/ui/PurchasingRfq/PurchasingRFQsTable.tsx` | `PurchasingRFQ` | `memo, useMemo, useState` | `usePermissions` |
| 4 | `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx` | `PurchaseInvoiceListItem` | `memo, useMemo, useState` | `useCurrencyFormatter, usePermissions` |
| 5 | `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrdersTable.tsx` | `SalesOrderListItem` | `memo, useMemo, useState` | `useCurrencyFormatter, usePermissions` |
| 6 | `apps/erp/app/modules/sales/ui/Quotes/QuotesTable.tsx` | `QuotationListItem` | `memo, useMemo, useState` | `usePermissions` |
| 7 | `apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQsTable.tsx` | `SalesRFQ` | `memo, useMemo, useState` | `usePermissions` |
| 8 | `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx` | `SalesInvoiceListItem` | `memo, useMemo, useState` | `useCurrencyFormatter, usePermissions` |

- Copy from (precedent): `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticesTable.tsx` (`search` from `useUrlParams`, `canExpandRow`, `expandRowsFor={search}`, lines 80, 256, 360–362)

None of the 8 files declares `search`, `params`, `terms`, `canExpandRow` or `renderExpandedRow` today.

**Steps (do steps 1–6 in each of the 8 files, with that file's row type as `RowType`):**
1. In the `react` import, add `useCallback` if it is missing.
2. In the `~/hooks` import, add `useUrlParams`.
3. Add the imports:
   ```tsx
   import { MatchingLines } from "~/components/MatchingLines";
   import { matchingSearchLines, searchTerms } from "~/utils/search";
   ```
4. Inside the component, after the last existing hook call and before `return (`, add:
   ```tsx
   const [params] = useUrlParams();
   const search = params.get("search");
   const terms = useMemo(() => searchTerms(search), [search]);
   // While a search is active, a row opens to the lines that matched it.
   const canExpandRow = useCallback(
     (row: RowType) => matchingSearchLines(row, terms).length > 0,
     [terms]
   );
   const renderExpandedRow = useCallback(
     (row: RowType) => <MatchingLines row={row} terms={terms} />,
     [terms]
   );
   ```
5. On the `<Table<RowType> …>` element, add these 4 props after `data={data}`:
   ```tsx
   renderExpandedRow={terms.length > 0 ? renderExpandedRow : undefined}
   canExpandRow={canExpandRow}
   expandRowsFor={search}
   pinExpandedRows
   ```
6. Change nothing else in the file. Keep `renderContextMenu`, `renderActions` and the columns as they are.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
FILES="apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuotesTable.tsx apps/erp/app/modules/purchasing/ui/PurchasingRfq/PurchasingRFQsTable.tsx apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx apps/erp/app/modules/sales/ui/SalesOrder/SalesOrdersTable.tsx apps/erp/app/modules/sales/ui/Quotes/QuotesTable.tsx apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQsTable.tsx apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx"
grep -c "expandRowsFor={search}" $FILES
# Expected: each file ":1"
pnpm exec biome check $FILES
# Expected: no errors
```

**Out of scope:** new columns, a CSV column for the lines (the spec keeps the CSV unchanged), the other 6 lists of the research (returns, receipts, shipments, jobs, transfers).

---

## Task 7: Remove Inventory → Receiving

**Depends on:** Tasks 2, 4
**Files:**
- Delete: `apps/erp/app/routes/x+/inventory+/receiving.tsx`
- Delete: `apps/erp/app/modules/inventory/ui/Receiving/ReceivingTable.tsx` (the folder holds only this file)
- Modify: `apps/erp/app/modules/inventory/ui/useInventorySubmodules.tsx` (nav entry lines 70–75, icon import line 14)
- Modify: `apps/erp/app/utils/path.ts` (line 2263)
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` (functions at lines ~967–1045, `fetchAllByIds` import at line 25, `searchTerms` import from Task 4)
- Modify: `apps/erp/app/modules/inventory/types.ts` (import at line 17, types at lines 243–269)
- Modify: `apps/erp/app/modules/shared/shared.service.ts` (comment at lines 11957–11958)

Checked callers (grep over `apps`, `packages`, `docs`, `.claude`): `getPurchaseOrderLinesToReceive`, `getOpenPurchaseOrdersForItems` and `getDraftReceiptsForPurchaseOrders` are called only by `receiving.tsx`. None is a `defineServiceFn`, so no MCP tool, API route or swagger entry names them. `path.to.receiving` is used only by the route and the nav. The `receiving` keys in `packages/printing`, `packages/database/src/seed-printing.ts` and `packages/ee/src/mcp/catalog-search.ts` are a printer context and a search synonym, not this page. Leave them.

**Steps:**
1. Run `git rm apps/erp/app/routes/x+/inventory+/receiving.tsx apps/erp/app/modules/inventory/ui/Receiving/ReceivingTable.tsx`.
2. In `useInventorySubmodules.tsx`, delete the route object `{ name: t\`Receiving\`, to: path.to.receiving, icon: <LuPackageSearch />, … permission: "purchasing" },` inside the "Shipping & Receiving" group. Keep the group and its other routes.
3. In `useInventorySubmodules.tsx`, delete `LuPackageSearch,` from the `react-icons/lu` import (it has no other use).
4. In `path.ts`, delete the line `receiving: \`${x}/inventory/receiving\`,`.
5. In `inventory.service.ts`, delete `getPurchaseOrderLinesToReceive`, `getOpenPurchaseOrdersForItems` and `getDraftReceiptsForPurchaseOrders` with their doc comments.
6. In `inventory.service.ts`, delete `fetchAllByIds,` from its import (line 25). Its only 2 uses were in the deleted functions.
7. In `inventory.service.ts`, delete the `import { searchTerms } from "~/utils/search";` line that Task 4 added. Its only use was in the deleted function.
8. In `types.ts`, delete `getPurchaseOrderLinesToReceive,` from the `./inventory.service` type import.
9. In `types.ts`, delete the types `PurchaseOrderLineToReceive`, `ReceivingOrder`, `ReceivingDraftReceipt` and `ReceivingRow` with their doc comments.
10. In `shared.service.ts`, delete the 2 comment lines `// The \`purchaseOrderLinesToReceive\` view (Inventory →` and `// Receiving) lists the same types: change both together.`.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
grep -rn -E "getPurchaseOrderLinesToReceive|getOpenPurchaseOrdersForItems|getDraftReceiptsForPurchaseOrders|purchaseOrderLinesToReceive|path\.to\.receiving\b|ReceivingRow|ReceivingOrder|ReceivingDraftReceipt|PurchaseOrderLineToReceive|ui/Receiving" apps/erp/app
# Expected: no output
test -e apps/erp/app/routes/x+/inventory+/receiving.tsx || echo route-gone
# Expected: route-gone
pnpm exec biome check apps/erp/app/modules/inventory/ui/useInventorySubmodules.tsx apps/erp/app/utils/path.ts apps/erp/app/modules/inventory/inventory.service.ts apps/erp/app/modules/inventory/types.ts apps/erp/app/modules/shared/shared.service.ts
# Expected: no errors (noUnusedImports passes)
```

**Out of scope:** docs, rules and AGENTS.md (Task 9), the "Shipping & Receiving" group name, Settings → Inventory → Receiving (a different page).

---

## Task 8: Reuse the Draft receipt of a purchase order

**Depends on:** Task 0 (independent of Tasks 1–7)
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` (`createReceipt`, lines 104–159)
- Create: `apps/erp/test/database/create-receipt-draft-reuse.test.ts`
- Copy from (precedent): `apps/erp/test/database/inventory-document-guards.test.ts` (fixture, `ctx()`, `seed`, `f.cleanup()`), `apps/erp/test/database/fixtures/always-post.ts:501-521` (purchase order insert)

Both Receive entry points post to `path.to.newReceipt` → `receipt+/new.tsx` → `api.inventory.createReceipt`: the PO page (`PurchaseOrderHeader.tsx:517`, `:556`) and the list's right-click Receive (`PurchaseOrdersTable.tsx:497`), both through `usePurchaseOrder.receive` (`usePurchaseOrder.ts:35-44`). So one change covers both.

**Steps:**
1. In the `createReceipt` doc comment, replace the paragraph
   `A sales return order or rental agreement with a Draft receipt already returns that receipt instead of a second one.`
   with
   `A sales return order or rental agreement with a Draft receipt already returns that receipt instead of a second one. A purchase order with Draft receipts returns the oldest one.`
2. Replace the condition
   ```ts
   if (
     sourceDocument === "Sales Return Order" ||
     sourceDocument === "Rental Agreement"
   ) {
   ```
   with
   ```ts
   if (
     sourceDocument === "Purchase Order" ||
     sourceDocument === "Sales Return Order" ||
     sourceDocument === "Rental Agreement"
   ) {
   ```
3. In the same block, replace `.order("createdAt", { ascending: false })` with:
   ```ts
   // A purchase order reuses its oldest Draft; a return order or an
   // agreement keeps its newest, as before.
   .order("createdAt", { ascending: sourceDocument === "Purchase Order" })
   .order("id", { ascending: true })
   ```
4. Change the comment `// One open draft per return order or agreement: …` to `// One open draft per purchase order, return order or agreement: a second Receive goes to the existing draft instead of stacking up duplicates.`
5. Create `apps/erp/test/database/create-receipt-draft-reuse.test.ts` with this content:

```ts
// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. Receive on a purchase order must open the
// order's oldest Draft receipt, not start another one.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as inventory from "../../app/modules/inventory/inventory.server";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

let f: Fixture;
let ids: ReturnType<typeof idsOf>;

const idsOf = (prefix: string) => ({
  purchaseOrder: `${prefix}-po-draft-reuse`,
  otherPurchaseOrder: `${prefix}-po-other`,
  olderDraft: `${prefix}-receipt-older`,
  newerDraft: `${prefix}-receipt-newer`,
  otherOrderDraft: `${prefix}-receipt-other-order`
});

// The system, on behalf of the seeded system user: the permission gate passes.
const ctx = () =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

const draftReceipt = (
  id: string,
  receiptId: string,
  purchaseOrderId: string,
  createdAt: string
) => ({
  id,
  receiptId,
  status: "Draft" as const,
  sourceDocument: "Purchase Order" as const,
  sourceDocumentId: purchaseOrderId,
  locationId: f.locationId,
  companyId: f.companyId,
  createdBy: USER,
  createdAt
});

beforeAll(async () => {
  if (!client) return;
  f = await alwaysPostFixture();
  ids = idsOf(f.prefix);
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: ids.purchaseOrder,
        purchaseOrderId: `${f.prefix}-PO-REUSE`,
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("receipt")
      .values([
        // Another order's Draft is the oldest of all: it must not be reused.
        draftReceipt(
          ids.otherOrderDraft,
          `${f.prefix}-RE-OTHER`,
          ids.otherPurchaseOrder,
          "2026-01-01T00:00:00+00:00"
        ),
        draftReceipt(
          ids.olderDraft,
          `${f.prefix}-RE-OLDER`,
          ids.purchaseOrder,
          "2026-01-02T00:00:00+00:00"
        ),
        draftReceipt(
          ids.newerDraft,
          `${f.prefix}-RE-NEWER`,
          ids.purchaseOrder,
          "2026-01-03T00:00:00+00:00"
        )
      ])
      .execute();
  });
}, 60_000);

afterAll(async () => {
  if (!client) return;
  await f.cleanup();
}, 60_000);

const receiptCount = async () =>
  (
    await f.db
      .selectFrom("receipt")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute()
  ).length;

describeLocal("Receive on a purchase order", () => {
  it("opens the order's oldest Draft receipt and creates none", async () => {
    const before = await receiptCount();

    const result = await inventory.createReceipt(ctx(), {
      sourceDocument: "Purchase Order",
      sourceDocumentId: ids.purchaseOrder
    });

    expect(result.data).toEqual({ id: ids.olderDraft });
    expect(await receiptCount()).toBe(before);
  });
});
```

6. Run `git add -N apps/erp/test/database/create-receipt-draft-reuse.test.ts`.
7. Run `pnpm --filter @carbon/checks license-headers -- apps/erp/test/database/create-receipt-draft-reuse.test.ts`.

If the receipt insert fails with a NOT NULL or CHECK error on a column this test does not set, STOP and report the error. Do not add columns by guess.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)" \
  pnpm --filter erp exec vitest run test/database/create-receipt-draft-reuse.test.ts
# Expected: 1 passed. If it says "1 skipped", the database URL did not reach the test: STOP and report.
pnpm exec biome check apps/erp/app/modules/inventory/inventory.server.ts apps/erp/test/database/create-receipt-draft-reuse.test.ts
# Expected: no errors
```

**Out of scope:** the "New Receipt" label in the PO header's Receipts menu, shipments, inbound transfers.

---

## Task 9: Update docs, rules, AGENTS.md and the catalogs

**Depends on:** Tasks 5a, 5b, 5c, 6b, 7, 8
**Files:**
- Modify: `apps/erp/app/modules/inventory/AGENTS.md` (row at line 52, bullet at line 113, `createReceipt` row at line 69)
- Modify: `apps/erp/app/modules/purchasing/AGENTS.md` (Key Service Functions, line 64)
- Modify: `apps/erp/app/modules/sales/AGENTS.md` (Key Service Functions, after line 67)
- Modify: `apps/erp/app/modules/invoicing/AGENTS.md` (Key Service Functions, after line 186)
- Modify: `.claude/rules/shipments-receipts-ui-patterns.md` (lines 14, 16–21)
- Modify: `.claude/rules/table-infinite-scroll.md` (new subsection after the "Rules for the query" table)
- Modify: `docs/content/docs/reference/receipts.mdx` (section "Find the purchase order for a delivery", lines 10–14)
- Modify: `docs/content/docs/reference/purchase-orders.mdx`, `supplier-quotes.mdx`, `sales-orders.mdx`, `quotes.mdx`, `invoices.mdx`
- Modify (generated): `packages/locale/locales/*/erp.po`, `packages/locale/locales/*/mes.po`

**Steps:**
1. `inventory/AGENTS.md`: delete the table row that starts with `` | `purchaseOrderLinesToReceive` (view) ``.
2. `inventory/AGENTS.md`: delete the bullet that starts with `` - `getPurchaseOrderLinesToReceive` / `getOpenPurchaseOrdersForItems` ``.
3. `inventory/AGENTS.md`: in the `createReceipt` / `createShipment` row, replace `a return order or rental agreement with a Draft document returns that one.` with `a return order or rental agreement with a Draft document returns that one; a purchase order with Draft receipts returns the oldest.`
4. `purchasing/AGENTS.md`: after the bullet `` - `getPurchaseOrder` / `getPurchaseOrders` / `getPurchaseOrderLines` — read POs ``, add:
   ```md
   - `getPurchaseOrders` / `getSupplierQuotes` / `getPurchasingRFQs` — the list reads. A search adds one `ilike` on the computed field `searchText` per word (`searchTerms`, `~/utils/search`), so every word must occur in the document or its lines, case, spaces and punctuation ignored. While a search is active the select also reads `searchLines` (`withSearchLines`), and the table shows the matching lines under each row (`MatchingLines`, `~/components/MatchingLines`). Both fields are SQL functions of the list view (migrations `*_deep-list-search-spike.sql` and `*_deep-list-search.sql`); `select=*` never reads them.
   ```
5. `sales/AGENTS.md`: at the top of "Key Service Functions", add the same bullet with `` `getSalesOrders` / `getQuotes` / `getSalesRFQs` `` as its subject.
6. `invoicing/AGENTS.md`: at the top of "Key Service Functions", add the same bullet with `` `getPurchaseInvoices` / `getSalesInvoices` `` as its subject. Add one sentence: `The supplier and customer names come through a LEFT JOIN, so an invoicing-only user still sees every invoice.`
7. `shipments-receipts-ui-patterns.md` line 14: change `` only holds the two list routes `shipments.tsx` / `receipts.tsx`, and `receiving.tsx`). `` to `` only holds the two list routes `shipments.tsx` / `receipts.tsx`). ``
8. `shipments-receipts-ui-patterns.md`: replace the paragraph that starts `**Inventory → Receiving**` (lines 16–21) with:
   ```md
   **Finding the purchase order for a delivery** is the Purchase Orders list search: it matches line values (part number, name, the supplier's part number, description) as well as the order (see `table-infinite-scroll.md` → Searching line values). Receive on an order with a Draft receipt opens the oldest Draft (`createReceipt`); it does not start a second receipt.
   ```
9. `table-infinite-scroll.md`: after the "Rules for the query" table (ends before `## Sortable columns`), add:
   ```md
   ### Searching line values

   Eight lists also search their documents' lines: Purchase Orders, Supplier Quotes, Purchasing RFQs, Purchase Invoices, Sales Orders, Sales Quotes, Sales RFQs and Sales Invoices.

   1. Each list view has two PostgREST computed fields, `"searchText"(<view>)` and `"searchLines"(<view>)` (migrations `*_deep-list-search-spike.sql` and `*_deep-list-search.sql`). `select=*` never reads them.
   2. The service adds one `.ilike("searchText", "%word%")` per word of `searchTerms(search)` (`~/utils/search`). PostgREST joins them with AND.
   3. The service selects `withSearchLines(COLUMNS, search)`. It adds `searchLines` only while the search has a word, and keeps the select's literal type.
   4. The table passes `renderExpandedRow` only while a search is active, with `canExpandRow` (`matchingSearchLines(row, terms).length > 0`), `expandRowsFor={search}` and `pinExpandedRows`. The expanded row is `MatchingLines` (`~/components/MatchingLines`).
   5. The Table keeps "Expand" first in the left pins whenever `renderExpandedRow` is set (`effectiveColumnPinning`, `Table.tsx`).

   Paging, the count, the CSV export and the bulk actions are unchanged: the lines come in the same query, and the export writes only the columns the browser sends.
   ```
10. `receipts.mdx`: replace the two paragraphs under `## Find the purchase order for a delivery` with:
    ```md
    Search **Purchasing → Purchase Orders** with whatever the packing slip shows: order number, supplier, part number or name, the supplier's part number, the supplier's reference, or the tracking number. Every word must match, and case, spaces and punctuation are ignored, so `BRK-514` finds `BRK514`. Each order with a matching line opens and shows the lines that matched.

    **Receive** on an order that already has a Draft receipt opens the oldest Draft receipt instead of starting a second one.
    ```
11. `purchase-orders.mdx`: before `## Related`, add:
    ```md
    ## Search

    The search box on **Purchasing → Purchase Orders** also finds an order by a value on its lines: the part number or name, the supplier's part number, or the line description. It also matches the order number, the supplier, the supplier's reference, the tracking number and the job. Every word must match, and case, spaces and punctuation are ignored. While you search, each order with a matching line opens and shows the lines that matched.
    ```
12. `supplier-quotes.mdx`: before `## Troubleshooting`, add a `## Search` section with the text of step 11, changed to **Purchasing → Supplier Quotes**, "quote", and the values: the part number or name, the supplier's part number, or the line description; the quote number, the supplier and the supplier's reference.
13. `sales-orders.mdx`: before `## Related`, add a `## Search` section with the text of step 11, changed to **Sales → Sales Orders**, and the values: the part number or name, the customer's part number, or the line description; the order number, the customer, the customer's reference and the tracking number.
14. `quotes.mdx`: before `## Related`, add a `## Search` section with the text of step 11, changed to **Sales → Quotes**, "quote", and the values: the part number or name, the customer's part number, or the line description; the quote number, the customer and the customer's reference.
15. `invoices.mdx`: before `## Related`, add a `## Search` section: "The search boxes on **Invoicing → Purchase Invoices** and **Invoicing → Sales Invoices** also find an invoice by a value on its lines: the part number or name, the line description, the order number, or the supplier's or customer's part number. They also match the invoice number, the supplier or customer, and their reference. Every word must match, and case, spaces and punctuation are ignored. While you search, each invoice with a matching line opens and shows the lines that matched."
16. Run `pnpm run lingui:extract && pnpm run lingui:clean` (`.ai/lessons.md` → "`.po` catalogs are committed only after `lingui:clean`"). This plan adds no new message, so the run only prunes the Receiving strings.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
grep -rn -E "purchaseOrderLinesToReceive|getPurchaseOrderLinesToReceive|\*\*Inventory → Receiving\*\*|inventory\+/receiving|receiving\.tsx|ReceivingTable" apps/erp/app .claude/rules docs/content/docs
# Expected: no output
grep -c "## Search" docs/content/docs/reference/purchase-orders.mdx docs/content/docs/reference/supplier-quotes.mdx docs/content/docs/reference/sales-orders.mdx docs/content/docs/reference/quotes.mdx docs/content/docs/reference/invoices.mdx
# Expected: each ":1"
grep -c "Showing the oldest orders only" packages/locale/locales/en/erp.po
# Expected: 0
pnpm --filter @carbon/content test
# Expected: all tests pass (links.test.ts included)
```

**Out of scope:** the changelog entry, the `.ai/specs/` and `.ai/plans/` files that mention Receiving as history, `pnpm run translate`.

---

## Task 10: Run the final verification

**Depends on:** all tasks
**Files:** none (append results to `.ai/runs/2026-11-02-deep-list-search.md`)

**Steps:**
1. Run each command of the Verify block, one at a time.
2. If a command fails, fix the cause in the file it names. Then run that command again.
3. 🛑 If typecheck reports a missing `searchText` or `searchLines` key in an object literal typed as a view `Row`, STOP and report. That means the generated types made the computed fields required keys.
4. Ask the user for permission to use the browser. Then run the browser checks with the `/test` skill (`.claude/skills/test/SKILL.md`) on the satellite seed (`pnpm db:seed:dev -- --dataset satellite`). The user seeds; do not seed yourself.
5. Write each check's result (pass / fail / skipped and why) in the run log.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-deep-list-search
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm exec biome check $(git diff --name-only --diff-filter=AM HEAD -- '*.ts' '*.tsx') $(git ls-files --others --exclude-standard -- '*.ts' '*.tsx')
# Expected: no errors
pnpm --filter erp exec vitest run app/utils/search.test.ts app/modules/inventory/inventory.utils.test.ts
# Expected: all pass
SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)" \
  pnpm --filter erp exec vitest run test/database/create-receipt-draft-reuse.test.ts
# Expected: 1 passed
pnpm --filter @carbon/checks test
# Expected: all pass (list-select-covers-columns, spdx-license-header, no-raw-or-search, module-shape)
```

**Browser checks (the spec's acceptance criteria):**

| # | Check | Expected |
|---|---|---|
| 1 | Purchase Orders, search `CEX Q 4471 battery` | The order made from the winning RFQ quote (supplier reference CEX-Q-4471, line "Li-Ion Battery Pack 48V 100Wh") shows. Its row is open. The battery line shows with "battery" marked. |
| 2 | On a purchase order line, set the Supplier Part Number to `BRK514`. Then search Purchase Orders for `brk-514` | That order shows. Its row opens to that line with `BRK514` marked. (The seed has no such number; the tester enters it.) |
| 3 | On each of the 8 lists, search for an item readable id that is on one document's lines | That document shows, and its row opens to the line. |
| 4 | On each of the 8 lists, search for a document number | The document shows. Its row has no chevron and does not open. |
| 5 | Search `<word on a document> zzqqxxnomatch` | No rows. |
| 6 | Sales Orders, search `ORB BUS 4400` (a seeded customer part number) | Each order of that customer that has the item shows. If no order has it, record "skipped: no order for the part". |
| 7 | Purchase Invoices with no search, as an invoicing-only user | Same rows as before. With no search the service adds no filter (`searchTerms` returns `[]`). If no such user exists, record "skipped: verified by code". |
| 8 | Any list with no search; open the browser's Network tab, reload | The list's `.data` response has no `searchText` and no `searchLines`. The table has no Expand column. |
| 9 | A search that matches more than 100 documents, then scroll | Page 2 loads, and its rows open with their lines. If the seed has 100 or fewer matches, record "skipped: not enough rows". |
| 10 | Search a list, then Download CSV | One row per document, the same columns as before the search. |
| 11 | Open `/x/inventory/receiving` | The not-found page. The Inventory nav has no "Receiving" item. |
| 12 | Receive on a PO that has a Draft receipt (list right-click and PO page) | That Draft receipt opens. The PO's receipt count does not change. |
| 13 | Receive on a PO with no Draft receipt | A new receipt is created, as before. |
| 14 | Close an opened row, then change the search | The row stays closed until the search changes; after the change it opens again. |

**Out of scope:** commits, `pnpm db:check:datasets`, `pnpm db:check:backups`, `pnpm run generate:mcp` (no operation input or response schema changes).
