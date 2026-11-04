-- Deep search on the order and quote lists (.ai/specs/2026-11-02-deep-list-search.md).
--
--   "searchLines"(<view>) — a PostgREST computed field (a function of the
--       view's row): the document's lines as JSON. PostgREST runs it only when
--       a query selects it, so select=* and the detail pages never pay for it.
--   "search<List>"(company_id, terms) — the list rows that match every word.
--       The list read calls it in place of the view when there is a search.
--
-- Every party and part-number join is a LEFT JOIN: a row the caller's RLS
-- hides gives NULL and never hides the document. Every lookup also matches the
-- document's companyId, because several list routes read these with RLS
-- bypassed. "searchLines" has no parameter name, so it is not exposed as /rpc.

-- A value as search stores it: lower-cased, everything but letters and digits
-- removed (BRK-514 and brk 514 both read brk514). `searchTerms`
-- (apps/erp/app/utils/search.ts) normalizes a search word the same way.
CREATE OR REPLACE FUNCTION search_normalize(TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(lower($1), '[^[:alnum:]]+', '', 'g');
$$;

-- ---------------------------------------------------------------------------
-- searchLines
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
    AND i."companyId" = $1."companyId"
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
    AND pl."companyId" = $1."companyId";
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
    AND i."companyId" = $1."companyId"
  WHERE sq."supplierQuoteId" = $1."id"
    AND sq."companyId" = $1."companyId";
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
        'quantity', to_jsonb(rl."quantity"),
        'unitOfMeasureCode', rl."purchaseUnitOfMeasureCode"
      )
      ORDER BY rl."order", rl."id"
    ),
    '[]'::jsonb
  )
  FROM "purchasingRfqLine" rl
  LEFT JOIN "item" i ON i."id" = rl."itemId"
    AND i."companyId" = $1."companyId"
  WHERE rl."purchasingRfqId" = $1."id"
    AND rl."companyId" = $1."companyId";
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
        'orderNumber', po."purchaseOrderId",
        'quantity', il."quantity",
        'unitOfMeasureCode', il."purchaseUnitOfMeasureCode"
      )
      ORDER BY il."sortOrder", il."id"
    ),
    '[]'::jsonb
  )
  FROM "purchaseInvoiceLine" il
  LEFT JOIN "item" i ON i."id" = il."itemId"
    AND i."companyId" = $1."companyId"
  LEFT JOIN "purchaseOrder" po ON po."id" = il."purchaseOrderId"
    AND po."companyId" = $1."companyId"
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
    AND il."companyId" = $1."companyId";
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
    AND i."companyId" = $1."companyId"
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
    AND sol."companyId" = $1."companyId";
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
    AND i."companyId" = $1."companyId"
  WHERE ql."quoteId" = $1."id"
    AND ql."companyId" = $1."companyId";
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
    AND i."companyId" = $1."companyId"
  WHERE rl."salesRfqId" = $1."id"
    AND rl."companyId" = $1."companyId";
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
        'orderNumber', so."salesOrderId",
        'quantity', il."quantity",
        'unitOfMeasureCode', il."unitOfMeasureCode"
      )
      ORDER BY il."sortOrder", il."id"
    ),
    '[]'::jsonb
  )
  FROM "salesInvoiceLine" il
  LEFT JOIN "item" i ON i."id" = il."itemId"
    AND i."companyId" = $1."companyId"
  LEFT JOIN "salesOrder" so ON so."id" = il."salesOrderId"
    AND so."companyId" = $1."companyId"
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
    AND il."companyId" = $1."companyId";
$$;

-- ---------------------------------------------------------------------------
-- search<List>: the list rows where every word occurs in a header value or in
-- a line value. Each function finds the matching documents from the company's
-- headers and lines in one pass, then reads the view only for those ids. A
-- filter that rebuilt every row's text took about 700 ms at 1,800 orders,
-- because Postgres must build the text of each row before it can drop one.
--
-- The line values are the "searchLines" values that `matchingSearchLines`
-- (apps/erp/app/utils/search.ts) reads, so a row a line matched has a line to
-- show. "|" joins the values of one row, so a word never spans two values.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "searchPurchaseOrders"(company_id TEXT, terms TEXT[])
RETURNS SETOF "purchaseOrders"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH term AS (
    SELECT DISTINCT search_normalize(t) AS t FROM unnest(terms) t
    WHERE search_normalize(t) <> ''
  ),
  -- Each row's text is built once, then matched against every word.
  row_text AS MATERIALIZED (
    SELECT p."id" AS "id", concat_ws('|',
        search_normalize(p."purchaseOrderId"),
        search_normalize(p."supplierReference"),
        search_normalize(p."jobReadableId"),
        search_normalize(s."name"),
        search_normalize(d."trackingNumber")
      ) AS "text"
    FROM "purchaseOrder" p
    LEFT JOIN "supplier" s ON s."id" = p."supplierId"
      AND s."companyId" = p."companyId"
    LEFT JOIN "purchaseOrderDelivery" d ON d."id" = p."id"
      AND d."companyId" = p."companyId"
    WHERE p."companyId" = company_id
    UNION ALL
    SELECT pl."purchaseOrderId" AS "id", concat_ws('|',
        search_normalize(i."readableIdWithRevision"),
        search_normalize(i."name"),
        search_normalize(pl."description"),
        search_normalize(COALESCE(NULLIF(pl."supplierPartId", ''), sp."supplierPartId"))
      ) AS "text"
    FROM "purchaseOrderLine" pl
    JOIN "purchaseOrder" p ON p."id" = pl."purchaseOrderId"
      AND p."companyId" = pl."companyId"
    LEFT JOIN "item" i ON i."id" = pl."itemId"
      AND i."companyId" = pl."companyId"
    LEFT JOIN LATERAL (
      SELECT sp."supplierPartId"
      FROM "supplierPart" sp
      WHERE sp."supplierId" = p."supplierId"
        AND sp."itemId" = pl."itemId"
        AND sp."companyId" = pl."companyId"
      ORDER BY sp."id"
      LIMIT 1
    ) sp ON TRUE
    WHERE pl."companyId" = company_id
  ),
  hit AS (
    SELECT row_text."id", term.t
    FROM row_text
    JOIN term ON row_text."text" LIKE '%' || term.t || '%'
  )
  SELECT v.*
  FROM "purchaseOrders" v
  WHERE v."companyId" = company_id
    AND v."id" IN (
      SELECT hit."id" FROM hit
      GROUP BY hit."id"
      HAVING count(DISTINCT hit.t) = (SELECT count(*) FROM term)
    );
$$;

CREATE OR REPLACE FUNCTION "searchSupplierQuotes"(company_id TEXT, terms TEXT[])
RETURNS SETOF "supplierQuotes"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH term AS (
    SELECT DISTINCT search_normalize(t) AS t FROM unnest(terms) t
    WHERE search_normalize(t) <> ''
  ),
  -- Each row's text is built once, then matched against every word.
  row_text AS MATERIALIZED (
    SELECT q."id" AS "id", concat_ws('|',
        search_normalize(q."supplierQuoteId"),
        search_normalize(q."supplierReference"),
        search_normalize(s."name")
      ) AS "text"
    FROM "supplierQuote" q
    LEFT JOIN "supplier" s ON s."id" = q."supplierId"
      AND s."companyId" = q."companyId"
    WHERE q."companyId" = company_id
    UNION ALL
    SELECT sq."supplierQuoteId" AS "id", concat_ws('|',
        search_normalize(i."readableIdWithRevision"),
        search_normalize(i."name"),
        search_normalize(sq."description"),
        search_normalize(sq."supplierPartId")
      ) AS "text"
    FROM "supplierQuoteLine" sq
    LEFT JOIN "item" i ON i."id" = sq."itemId"
      AND i."companyId" = sq."companyId"
    WHERE sq."companyId" = company_id
  ),
  hit AS (
    SELECT row_text."id", term.t
    FROM row_text
    JOIN term ON row_text."text" LIKE '%' || term.t || '%'
  )
  SELECT v.*
  FROM "supplierQuotes" v
  WHERE v."companyId" = company_id
    AND v."id" IN (
      SELECT hit."id" FROM hit
      GROUP BY hit."id"
      HAVING count(DISTINCT hit.t) = (SELECT count(*) FROM term)
    );
$$;

CREATE OR REPLACE FUNCTION "searchPurchasingRfqs"(company_id TEXT, terms TEXT[])
RETURNS SETOF "purchasingRfqs"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH term AS (
    SELECT DISTINCT search_normalize(t) AS t FROM unnest(terms) t
    WHERE search_normalize(t) <> ''
  ),
  -- Each row's text is built once, then matched against every word.
  row_text AS MATERIALIZED (
    SELECT r."id" AS "id", search_normalize(r."rfqId") AS "text"
    FROM "purchasingRfq" r
    WHERE r."companyId" = company_id
    UNION ALL
    SELECT prs."purchasingRfqId" AS "id", search_normalize(s."name") AS "text"
    FROM "purchasingRfqSupplier" prs
    JOIN "supplier" s ON s."id" = prs."supplierId"
      AND s."companyId" = prs."companyId"
    WHERE prs."companyId" = company_id
    UNION ALL
    SELECT rl."purchasingRfqId" AS "id", concat_ws('|',
        search_normalize(i."readableIdWithRevision"),
        search_normalize(i."name"),
        search_normalize(rl."description")
      ) AS "text"
    FROM "purchasingRfqLine" rl
    LEFT JOIN "item" i ON i."id" = rl."itemId"
      AND i."companyId" = rl."companyId"
    WHERE rl."companyId" = company_id
  ),
  hit AS (
    SELECT row_text."id", term.t
    FROM row_text
    JOIN term ON row_text."text" LIKE '%' || term.t || '%'
  )
  SELECT v.*
  FROM "purchasingRfqs" v
  WHERE v."companyId" = company_id
    AND v."id" IN (
      SELECT hit."id" FROM hit
      GROUP BY hit."id"
      HAVING count(DISTINCT hit.t) = (SELECT count(*) FROM term)
    );
$$;

CREATE OR REPLACE FUNCTION "searchPurchaseInvoices"(company_id TEXT, terms TEXT[])
RETURNS SETOF "purchaseInvoices"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH term AS (
    SELECT DISTINCT search_normalize(t) AS t FROM unnest(terms) t
    WHERE search_normalize(t) <> ''
  ),
  -- Each row's text is built once, then matched against every word.
  row_text AS MATERIALIZED (
    SELECT pi."id" AS "id", concat_ws('|',
        search_normalize(pi."invoiceId"),
        search_normalize(pi."supplierReference"),
        search_normalize(s."name")
      ) AS "text"
    FROM "purchaseInvoice" pi
    LEFT JOIN "supplier" s ON s."id" = pi."supplierId"
      AND s."companyId" = pi."companyId"
    WHERE pi."companyId" = company_id
    UNION ALL
    SELECT il."invoiceId" AS "id", concat_ws('|',
        search_normalize(i."readableIdWithRevision"),
        search_normalize(i."name"),
        search_normalize(il."description"),
        search_normalize(sp."supplierPartId"),
        search_normalize(po."purchaseOrderId")
      ) AS "text"
    FROM "purchaseInvoiceLine" il
    JOIN "purchaseInvoice" pi ON pi."id" = il."invoiceId"
      AND pi."companyId" = il."companyId"
    LEFT JOIN "item" i ON i."id" = il."itemId"
      AND i."companyId" = il."companyId"
    LEFT JOIN "purchaseOrder" po ON po."id" = il."purchaseOrderId"
      AND po."companyId" = il."companyId"
    LEFT JOIN LATERAL (
      SELECT sp."supplierPartId"
      FROM "supplierPart" sp
      WHERE sp."supplierId" = pi."supplierId"
        AND sp."itemId" = il."itemId"
        AND sp."companyId" = il."companyId"
      ORDER BY sp."id"
      LIMIT 1
    ) sp ON TRUE
    WHERE il."companyId" = company_id
  ),
  hit AS (
    SELECT row_text."id", term.t
    FROM row_text
    JOIN term ON row_text."text" LIKE '%' || term.t || '%'
  )
  SELECT v.*
  FROM "purchaseInvoices" v
  WHERE v."companyId" = company_id
    AND v."id" IN (
      SELECT hit."id" FROM hit
      GROUP BY hit."id"
      HAVING count(DISTINCT hit.t) = (SELECT count(*) FROM term)
    );
$$;

CREATE OR REPLACE FUNCTION "searchSalesOrders"(company_id TEXT, terms TEXT[])
RETURNS SETOF "salesOrders"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH term AS (
    SELECT DISTINCT search_normalize(t) AS t FROM unnest(terms) t
    WHERE search_normalize(t) <> ''
  ),
  -- Each row's text is built once, then matched against every word.
  row_text AS MATERIALIZED (
    SELECT so."id" AS "id", concat_ws('|',
        search_normalize(so."salesOrderId"),
        search_normalize(so."customerReference"),
        search_normalize(c."name"),
        search_normalize(sh."trackingNumber")
      ) AS "text"
    FROM "salesOrder" so
    LEFT JOIN "customer" c ON c."id" = so."customerId"
      AND c."companyId" = so."companyId"
    LEFT JOIN "salesOrderShipment" sh ON sh."id" = so."id"
      AND sh."companyId" = so."companyId"
    WHERE so."companyId" = company_id
    UNION ALL
    SELECT sol."salesOrderId" AS "id", concat_ws('|',
        search_normalize(i."readableIdWithRevision"),
        search_normalize(i."name"),
        search_normalize(sol."description"),
        search_normalize(cpi."customerPartId")
      ) AS "text"
    FROM "salesOrderLine" sol
    JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
      AND so."companyId" = sol."companyId"
    LEFT JOIN "item" i ON i."id" = sol."itemId"
      AND i."companyId" = sol."companyId"
    LEFT JOIN LATERAL (
      SELECT cpi."customerPartId"
      FROM "customerPartToItem" cpi
      WHERE cpi."customerId" = so."customerId"
        AND cpi."itemId" = sol."itemId"
        AND cpi."companyId" = sol."companyId"
      ORDER BY cpi."id"
      LIMIT 1
    ) cpi ON TRUE
    WHERE sol."companyId" = company_id
  ),
  hit AS (
    SELECT row_text."id", term.t
    FROM row_text
    JOIN term ON row_text."text" LIKE '%' || term.t || '%'
  )
  SELECT v.*
  FROM "salesOrders" v
  WHERE v."companyId" = company_id
    AND v."id" IN (
      SELECT hit."id" FROM hit
      GROUP BY hit."id"
      HAVING count(DISTINCT hit.t) = (SELECT count(*) FROM term)
    );
$$;

CREATE OR REPLACE FUNCTION "searchQuotes"(company_id TEXT, terms TEXT[])
RETURNS SETOF "quotes"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH term AS (
    SELECT DISTINCT search_normalize(t) AS t FROM unnest(terms) t
    WHERE search_normalize(t) <> ''
  ),
  -- Each row's text is built once, then matched against every word.
  row_text AS MATERIALIZED (
    SELECT q."id" AS "id", concat_ws('|',
        search_normalize(q."quoteId"),
        search_normalize(q."customerReference"),
        search_normalize(c."name")
      ) AS "text"
    FROM "quote" q
    LEFT JOIN "customer" c ON c."id" = q."customerId"
      AND c."companyId" = q."companyId"
    WHERE q."companyId" = company_id
    UNION ALL
    SELECT ql."quoteId" AS "id", concat_ws('|',
        search_normalize(i."readableIdWithRevision"),
        search_normalize(i."name"),
        search_normalize(ql."description"),
        search_normalize(ql."customerPartId")
      ) AS "text"
    FROM "quoteLine" ql
    LEFT JOIN "item" i ON i."id" = ql."itemId"
      AND i."companyId" = ql."companyId"
    WHERE ql."companyId" = company_id
  ),
  hit AS (
    SELECT row_text."id", term.t
    FROM row_text
    JOIN term ON row_text."text" LIKE '%' || term.t || '%'
  )
  SELECT v.*
  FROM "quotes" v
  WHERE v."companyId" = company_id
    AND v."id" IN (
      SELECT hit."id" FROM hit
      GROUP BY hit."id"
      HAVING count(DISTINCT hit.t) = (SELECT count(*) FROM term)
    );
$$;

CREATE OR REPLACE FUNCTION "searchSalesRfqs"(company_id TEXT, terms TEXT[])
RETURNS SETOF "salesRfqs"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH term AS (
    SELECT DISTINCT search_normalize(t) AS t FROM unnest(terms) t
    WHERE search_normalize(t) <> ''
  ),
  -- Each row's text is built once, then matched against every word.
  row_text AS MATERIALIZED (
    SELECT r."id" AS "id", concat_ws('|',
        search_normalize(r."rfqId"),
        search_normalize(r."customerReference"),
        search_normalize(c."name")
      ) AS "text"
    FROM "salesRfq" r
    LEFT JOIN "customer" c ON c."id" = r."customerId"
      AND c."companyId" = r."companyId"
    WHERE r."companyId" = company_id
    UNION ALL
    SELECT rl."salesRfqId" AS "id", concat_ws('|',
        search_normalize(i."readableIdWithRevision"),
        search_normalize(i."name"),
        search_normalize(rl."description"),
        search_normalize(rl."customerPartId")
      ) AS "text"
    FROM "salesRfqLine" rl
    LEFT JOIN "item" i ON i."id" = rl."itemId"
      AND i."companyId" = rl."companyId"
    WHERE rl."companyId" = company_id
  ),
  hit AS (
    SELECT row_text."id", term.t
    FROM row_text
    JOIN term ON row_text."text" LIKE '%' || term.t || '%'
  )
  SELECT v.*
  FROM "salesRfqs" v
  WHERE v."companyId" = company_id
    AND v."id" IN (
      SELECT hit."id" FROM hit
      GROUP BY hit."id"
      HAVING count(DISTINCT hit.t) = (SELECT count(*) FROM term)
    );
$$;

CREATE OR REPLACE FUNCTION "searchSalesInvoices"(company_id TEXT, terms TEXT[])
RETURNS SETOF "salesInvoices"
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH term AS (
    SELECT DISTINCT search_normalize(t) AS t FROM unnest(terms) t
    WHERE search_normalize(t) <> ''
  ),
  -- Each row's text is built once, then matched against every word.
  row_text AS MATERIALIZED (
    SELECT si."id" AS "id", concat_ws('|',
        search_normalize(si."invoiceId"),
        search_normalize(si."customerReference"),
        search_normalize(c."name")
      ) AS "text"
    FROM "salesInvoice" si
    LEFT JOIN "customer" c ON c."id" = si."customerId"
      AND c."companyId" = si."companyId"
    WHERE si."companyId" = company_id
    UNION ALL
    SELECT il."invoiceId" AS "id", concat_ws('|',
        search_normalize(i."readableIdWithRevision"),
        search_normalize(i."name"),
        search_normalize(il."description"),
        search_normalize(cpi."customerPartId"),
        search_normalize(so."salesOrderId")
      ) AS "text"
    FROM "salesInvoiceLine" il
    JOIN "salesInvoice" si ON si."id" = il."invoiceId"
      AND si."companyId" = il."companyId"
    LEFT JOIN "item" i ON i."id" = il."itemId"
      AND i."companyId" = il."companyId"
    LEFT JOIN "salesOrder" so ON so."id" = il."salesOrderId"
      AND so."companyId" = il."companyId"
    LEFT JOIN LATERAL (
      SELECT cpi."customerPartId"
      FROM "customerPartToItem" cpi
      WHERE cpi."customerId" = si."customerId"
        AND cpi."itemId" = il."itemId"
        AND cpi."companyId" = il."companyId"
      ORDER BY cpi."id"
      LIMIT 1
    ) cpi ON TRUE
    WHERE il."companyId" = company_id
  ),
  hit AS (
    SELECT row_text."id", term.t
    FROM row_text
    JOIN term ON row_text."text" LIKE '%' || term.t || '%'
  )
  SELECT v.*
  FROM "salesInvoices" v
  WHERE v."companyId" = company_id
    AND v."id" IN (
      SELECT hit."id" FROM hit
      GROUP BY hit."id"
      HAVING count(DISTINCT hit.t) = (SELECT count(*) FROM term)
    );
$$;
