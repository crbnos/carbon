ALTER TABLE "quote" ADD COLUMN "opportunityId" TEXT;
ALTER TABLE "quote" ADD COLUMN "completedDate" TIMESTAMPTZ;
ALTER TABLE "quote" ADD CONSTRAINT "quote_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL;

ALTER TABLE "salesRfq" ADD COLUMN "opportunityId" TEXT;
ALTER TABLE "salesRfq" ADD COLUMN "completedDate" TIMESTAMPTZ;
ALTER TABLE "salesRfq" ADD CONSTRAINT "salesRfq_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL;

ALTER TABLE "salesOrder" ADD COLUMN "opportunityId" TEXT;
ALTER TABLE "salesOrder" ADD COLUMN "completedDate" TIMESTAMPTZ;
ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL;

-- Update quote with opportunityId from opportunity table
UPDATE "quote" q
SET "opportunityId" = o."id"
FROM "opportunity" o
WHERE o."quoteId" = q."id";

-- Update salesRfq with opportunityId from opportunity table
UPDATE "salesRfq" r
SET "opportunityId" = o."id"
FROM "opportunity" o
WHERE o."salesRfqId" = r."id";

-- Update salesOrder with opportunityId from opportunity table
UPDATE "salesOrder" s
SET "opportunityId" = o."id"
FROM "opportunity" o
WHERE o."salesOrderId" = s."id";

-- Update quote with completed date from opportunity table
UPDATE "quote" q
SET "completedDate" = o."quoteCompletedDate"
FROM "opportunity" o
WHERE o."quoteId" = q."id" AND o."quoteCompletedDate" IS NOT NULL;

-- Update salesRfq with completed date from opportunity table
UPDATE "salesRfq" r
SET "completedDate" = o."salesRfqCompletedDate"
FROM "opportunity" o
WHERE o."salesRfqId" = r."id" AND o."salesRfqCompletedDate" IS NOT NULL;

-- Update salesOrder with completed date from opportunity table
UPDATE "salesOrder" s
SET "completedDate" = o."salesOrderCompletedDate"
FROM "opportunity" o
WHERE o."salesOrderId" = s."id" AND o."salesOrderCompletedDate" IS NOT NULL;

DROP VIEW "salesRfqs";
DROP VIEW "quotes";
DROP VIEW "salesOrders";

-- Drop the columns from opportunity table after data migration
ALTER TABLE "opportunity" DROP COLUMN IF EXISTS "salesRfqId";
ALTER TABLE "opportunity" DROP COLUMN IF EXISTS "quoteId";
ALTER TABLE "opportunity" DROP COLUMN IF EXISTS "salesOrderId";
ALTER TABLE "opportunity" DROP COLUMN IF EXISTS "salesRfqCompletedDate";
ALTER TABLE "opportunity" DROP COLUMN IF EXISTS "quoteCompletedDate";
ALTER TABLE "opportunity" DROP COLUMN IF EXISTS "salesOrderCompletedDate";

DROP VIEW IF EXISTS "salesRfqs";
CREATE OR REPLACE VIEW "salesRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  rfq.*,
  l."name" AS "locationName"
  FROM "salesRfq" rfq
  LEFT JOIN "location" l
    ON l.id = rfq."locationId";

DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType", 
    sl."orderTotal",
    sl."jobs",
    st."name" AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    l."name" AS "locationName"
  FROM "salesOrder" s
  LEFT JOIN (
    SELECT 
      sol."salesOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM((1+COALESCE(sol."taxPercent", 0))*(COALESCE(sol."saleQuantity", 0)*(COALESCE(sol."unitPrice", 0)) + COALESCE(sol."shippingCost", 0) + COALESCE(sol."addOnCost", 0))) AS "orderTotal",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        CASE 
          WHEN j.id IS NOT NULL THEN json_build_object('id', j.id, 'jobId', j."jobId", 'status', j."status")
          ELSE NULL 
        END
      ) FILTER (WHERE j.id IS NOT NULL) AS "jobs"
    FROM "salesOrderLine" sol
    LEFT JOIN "item" i
      ON i."id" = sol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    LEFT JOIN "job" j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol."id"
    GROUP BY sol."salesOrderId"
  ) sl ON sl."salesOrderId" = s."id"
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id"
  LEFT JOIN "location" l ON l."id" = ss."locationId";


DROP VIEW IF EXISTS "quotes";
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  ql."thumbnailPath",
  ql."itemType",
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  qs."shippingCost"
  FROM "quote" q
  LEFT JOIN (
    SELECT 
      "quoteId",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" != 'No Quote') AS "lines",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" = 'Complete') AS "completedLines", 
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM "quoteLine"
    INNER JOIN "item" i
      ON i."id" = "quoteLine"."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "quoteShipment" qs ON qs."id" = q."id"
  LEFT JOIN "location" l
    ON l.id = q."locationId";


DROP FUNCTION IF EXISTS get_opportunity_with_related_records(TEXT);
CREATE OR REPLACE FUNCTION get_opportunity_with_related_records(opportunity_id TEXT)
RETURNS TABLE (
  "id" TEXT,
  "companyId" TEXT,
  "purchaseOrderDocumentPath" TEXT,
  "requestForQuoteDocumentPath" TEXT,
  "salesRfqs" JSONB,
  "quotes" JSONB,
  "salesOrders" JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.*,
    (
      SELECT COALESCE(jsonb_agg(rfq.* ORDER BY rfq."revisionId" DESC), '[]'::jsonb)
      FROM "salesRfq" rfq
      WHERE rfq."opportunityId" = o.id
    ) AS "salesRfqs",
    (
      SELECT COALESCE(jsonb_agg(q.* ORDER BY q."revisionId" DESC), '[]'::jsonb)
      FROM "quote" q
      WHERE q."opportunityId" = o.id
    ) AS "quotes",
    (
      SELECT COALESCE(jsonb_agg(so.* ORDER BY so."revisionId" DESC), '[]'::jsonb)
      FROM "salesOrder" so
      WHERE so."opportunityId" = o.id
    ) AS "salesOrders"
  FROM "opportunity" o
  WHERE o.id = opportunity_id::text;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;


-- Drop the existing constraint for quote
ALTER TABLE "quote" DROP CONSTRAINT IF EXISTS "quote_quoteId_key";

-- Add the new constraint that includes revisionId for quote
ALTER TABLE "quote" ADD CONSTRAINT "quote_quoteId_revisionId_key" UNIQUE ("quoteId", "revisionId", "companyId");

-- Drop the existing constraint for salesOrder
ALTER TABLE "salesOrder" DROP CONSTRAINT IF EXISTS "salesOrder_salesOrderId_key";

-- Add the new constraint that includes revisionId for salesOrder
ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrder_salesOrderId_revisionId_key" UNIQUE ("salesOrderId", "revisionId", "companyId");

-- Drop the existing constraint for salesRfq
ALTER TABLE "salesRfq" DROP CONSTRAINT IF EXISTS "salesRfq_salesRfqId_key";

-- Add the new constraint that includes revisionId for salesRfq
ALTER TABLE "salesRfq" ADD CONSTRAINT "salesRfq_salesRfqId_revisionId_key" UNIQUE ("rfqId", "revisionId", "companyId");



CREATE OR REPLACE FUNCTION create_rfq_from_models_v2(
  company_id text,
  email text,
  sequence_number text,
  model_data json[]
)
RETURNS TABLE (
  rfq_id text,
  rfq_readable_id text,
  rfq_line_ids text[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rfq_id text;
  v_opportunity_id text;
  v_line_ids text[] := '{}';
  v_customer_id text;
  v_line_id text;
  model_item json;
BEGIN
  IF session_user = 'authenticator' THEN
    IF NOT (has_role('employee', company_id) OR has_valid_api_key_for_company(company_id)) THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
  END IF;

  -- Find customer ID from email
  SELECT cc."customerId" INTO v_customer_id
  FROM "contact" c
  JOIN "customerContact" cc ON cc."contactId" = c.id 
  WHERE c."email" = create_rfq_from_models_v2.email
  AND c."companyId" = company_id
  LIMIT 1;
  
  -- Create Opportunity first
  INSERT INTO "opportunity" (
    "companyId"
  )
  VALUES (
    company_id
  )
  RETURNING id INTO v_opportunity_id;
  
  -- Create RFQ with opportunityId
  INSERT INTO "salesRfq" (
    "rfqId",
    "customerId",
    "companyId",
    "createdBy",
    "opportunityId"
  )
  VALUES ( 
    sequence_number,
    v_customer_id,
    company_id,
    'system',
    v_opportunity_id
  )
  RETURNING id INTO v_rfq_id;

  -- Create RFQ Lines with models
  FOREACH model_item IN ARRAY model_data
  LOOP
    INSERT INTO "salesRfqLine" (
      "salesRfqId",
      "customerPartId", 
      "modelUploadId",
      "unitOfMeasureCode",
      "internalNotes",
      quantity,
      "companyId",
      "createdBy"
    )
    VALUES (
      v_rfq_id,
      (model_item->>'customer_part_id')::text,
      (model_item->>'model_id')::text,
      (model_item->>'unit_of_measure')::text,
      COALESCE((model_item->>'notes')::json, '{}'::json),
      ARRAY[1],
      company_id,
      'system'
    )
    RETURNING id INTO v_line_id;

    v_line_ids := array_append(v_line_ids, v_line_id);
  END LOOP;

  RETURN QUERY SELECT v_rfq_id, sequence_number, v_line_ids;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;
