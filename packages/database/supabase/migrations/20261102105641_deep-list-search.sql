-- Deep search on the order and quote lists (.ai/specs/2026-11-02-deep-list-search.md).
--
-- Each list view gets two PostgREST computed fields (functions of the view's
-- row). PostgREST runs one only when a query filters on it or selects it, so
-- select=* and the detail pages never pay for it:
--
--   "searchLines" — the document's lines as JSON, the one reader of lines.
--   "searchText"  — the header values plus the text of "searchLines", so a
--                   match on a line value is always a line the list can show.
--
-- Every party and part-number join is a LEFT JOIN: a row the caller's RLS
-- hides gives NULL and never hides the document. Every lookup also matches the
-- document's companyId, because several list routes read these with RLS
-- bypassed. The parameter has no name, so the function is not exposed as /rpc.

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

-- The searchable text of a "searchLines" array. "|" joins the values, so a
-- match never spans two values. `matchingSearchLines` reads the same keys.
CREATE OR REPLACE FUNCTION search_lines_text(JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT string_agg(
    concat_ws(
      '|',
      search_normalize(line->>'itemReadableId'),
      search_normalize(line->>'itemName'),
      search_normalize(line->>'description'),
      search_normalize(line->>'partNumber'),
      search_normalize(line->>'orderNumber')
    ),
    '|'
  )
  FROM jsonb_array_elements($1) AS line;
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
    AND il."companyId" = $1."companyId";
$$;

-- ---------------------------------------------------------------------------
-- searchText: the header values, then the text of "searchLines"
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "searchText"("purchaseOrders")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    search_normalize($1."purchaseOrderId"),
    search_normalize($1."supplierReference"),
    search_normalize($1."jobReadableId"),
    search_normalize((SELECT s."name" FROM "supplier" s WHERE s."id" = $1."supplierId" AND s."companyId" = $1."companyId")),
    search_normalize((SELECT d."trackingNumber" FROM "purchaseOrderDelivery" d WHERE d."id" = $1."id" AND d."companyId" = $1."companyId")),
    search_lines_text("searchLines"($1))
  );
$$;

CREATE OR REPLACE FUNCTION "searchText"("supplierQuotes")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    search_normalize($1."supplierQuoteId"),
    search_normalize($1."supplierReference"),
    search_normalize((SELECT s."name" FROM "supplier" s WHERE s."id" = $1."supplierId" AND s."companyId" = $1."companyId")),
    search_lines_text("searchLines"($1))
  );
$$;

CREATE OR REPLACE FUNCTION "searchText"("purchasingRfqs")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    search_normalize($1."rfqId"),
    (
      SELECT string_agg(search_normalize(s."name"), '|')
      FROM "purchasingRfqSupplier" prs
      JOIN "supplier" s ON s."id" = prs."supplierId"
      WHERE prs."purchasingRfqId" = $1."id"
        AND prs."companyId" = $1."companyId"
    ),
    search_lines_text("searchLines"($1))
  );
$$;

CREATE OR REPLACE FUNCTION "searchText"("purchaseInvoices")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    search_normalize($1."invoiceId"),
    search_normalize($1."supplierReference"),
    search_normalize((SELECT s."name" FROM "supplier" s WHERE s."id" = $1."supplierId" AND s."companyId" = $1."companyId")),
    search_lines_text("searchLines"($1))
  );
$$;

CREATE OR REPLACE FUNCTION "searchText"("salesOrders")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    search_normalize($1."salesOrderId"),
    search_normalize($1."customerReference"),
    search_normalize((SELECT c."name" FROM "customer" c WHERE c."id" = $1."customerId" AND c."companyId" = $1."companyId")),
    search_normalize((SELECT s."trackingNumber" FROM "salesOrderShipment" s WHERE s."id" = $1."id" AND s."companyId" = $1."companyId")),
    search_lines_text("searchLines"($1))
  );
$$;

CREATE OR REPLACE FUNCTION "searchText"("quotes")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    search_normalize($1."quoteId"),
    search_normalize($1."customerReference"),
    search_normalize((SELECT c."name" FROM "customer" c WHERE c."id" = $1."customerId" AND c."companyId" = $1."companyId")),
    search_lines_text("searchLines"($1))
  );
$$;

CREATE OR REPLACE FUNCTION "searchText"("salesRfqs")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    search_normalize($1."rfqId"),
    search_normalize($1."customerReference"),
    search_normalize((SELECT c."name" FROM "customer" c WHERE c."id" = $1."customerId" AND c."companyId" = $1."companyId")),
    search_lines_text("searchLines"($1))
  );
$$;

CREATE OR REPLACE FUNCTION "searchText"("salesInvoices")
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT concat_ws(
    '|',
    search_normalize($1."invoiceId"),
    search_normalize($1."customerReference"),
    search_normalize((SELECT c."name" FROM "customer" c WHERE c."id" = $1."customerId" AND c."companyId" = $1."companyId")),
    search_lines_text("searchLines"($1))
  );
$$;
