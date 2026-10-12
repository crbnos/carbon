-- Production → Scheduling → Outbound: the open jobs at a location that fill
-- a sales order, with where each one ships — what a truck is planned around.
--
-- "completionDate" is the day the job completes on the plant's calendar
-- (`time_zone`): its projected completion, or its due date while the scheduler
-- has not placed it. `through_date` bounds the horizon (NULL reads every open
-- job); `search` matches the job, order, customer, part and destination.
--
-- The ship-to is the order's `customerLocationId`; a drop shipment ships to the
-- shipment's own customer location instead.
--
-- SECURITY INVOKER: every table read runs under the caller's RLS, so this can
-- return nothing a REST read could not. The caller orders the rows.
CREATE OR REPLACE FUNCTION get_completion_jobs(
  company_id TEXT,
  location_id TEXT,
  time_zone TEXT,
  through_date DATE DEFAULT NULL,
  search TEXT DEFAULT NULL
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "status" "jobStatus",
  "itemReadableIdWithRevision" TEXT,
  "itemName" TEXT,
  "thumbnailPath" TEXT,
  "itemType" "itemType",
  "customerId" TEXT,
  "customerName" TEXT,
  "salesOrderId" TEXT,
  "salesOrderReadableId" TEXT,
  "customerReference" TEXT,
  "completionDate" DATE,
  "projectedCompletionAt" TIMESTAMPTZ,
  "dueDate" DATE,
  "promisedDate" DATE,
  "productionQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "shipToName" TEXT,
  "shipToCity" TEXT,
  "shipToState" TEXT,
  "shipToCountryCode" TEXT,
  "dropShipment" BOOLEAN,
  "shippingMethod" TEXT,
  "jobOperations" JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT *
  FROM (
    SELECT
      j."id",
      j."jobId",
      j."status",
      i."readableIdWithRevision" AS "itemReadableIdWithRevision",
      i."name" AS "itemName",
      COALESCE(i."thumbnailPath", mu."thumbnailPath") AS "thumbnailPath",
      i."type" AS "itemType",
      so."customerId",
      c."name" AS "customerName",
      so."id" AS "salesOrderId",
      so."salesOrderId" AS "salesOrderReadableId",
      so."customerReference",
      COALESCE(
        (j."projectedCompletionAt" AT TIME ZONE time_zone)::DATE,
        j."dueDate"
      ) AS "completionDate",
      j."projectedCompletionAt",
      j."dueDate",
      COALESCE(
        sol."promisedDate",
        ss."receiptPromisedDate",
        ss."receiptRequestedDate"
      ) AS "promisedDate",
      j."productionQuantity",
      j."quantityComplete",
      cl."name" AS "shipToName",
      a."city" AS "shipToCity",
      a."stateProvince" AS "shipToState",
      a."countryCode" AS "shipToCountryCode",
      COALESCE(ss."dropShipment", false) AS "dropShipment",
      sm."name" AS "shippingMethod",
      -- Only the job's top-level method: sub-assembly operations are not the
      -- job's own progress (the same scope as the customer portal).
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', jo."id",
              'order', jo."order",
              'status', jo."status",
              'description', COALESCE(p."name", jo."description"),
              'operationType', jo."operationType",
              'operationQuantity', jo."operationQuantity",
              'quantityComplete', jo."quantityComplete"
            )
            ORDER BY jo."order"
          )
          FROM "jobOperation" jo
          INNER JOIN "jobMakeMethod" jmm ON jmm."id" = jo."jobMakeMethodId"
          LEFT JOIN "process" p ON p."id" = jo."processId"
          WHERE jo."jobId" = j."id" AND jmm."parentMaterialId" IS NULL
        ),
        '[]'::JSONB
      ) AS "jobOperations"
    FROM "job" j
    INNER JOIN "salesOrder" so ON so."id" = j."salesOrderId"
    INNER JOIN "item" i ON i."id" = j."itemId"
    LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
    LEFT JOIN "customer" c ON c."id" = so."customerId"
    LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
    LEFT JOIN "salesOrderShipment" ss ON ss."id" = so."id"
    LEFT JOIN "shippingMethod" sm ON sm."id" = ss."shippingMethodId"
    LEFT JOIN "customerLocation" cl ON cl."id" = CASE
      WHEN ss."dropShipment" AND ss."customerLocationId" IS NOT NULL
        THEN ss."customerLocationId"
      ELSE so."customerLocationId"
    END
    LEFT JOIN "address" a ON a."id" = cl."addressId"
    WHERE j."companyId" = company_id
      AND j."locationId" = location_id
      AND j."status" IN ('Planned', 'Ready', 'In Progress', 'Paused')
  ) completions
  WHERE (through_date IS NULL OR completions."completionDate" <= through_date)
    AND (
      NULLIF(TRIM(search), '') IS NULL
      OR concat_ws(
        ' ',
        completions."jobId",
        completions."salesOrderReadableId",
        completions."customerReference",
        completions."customerName",
        completions."itemReadableIdWithRevision",
        completions."itemName",
        completions."shipToName",
        completions."shipToCity",
        completions."shipToState"
      ) ILIKE '%' || TRIM(search) || '%'
    );
$$;
