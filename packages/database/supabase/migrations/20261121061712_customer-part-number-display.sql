-- Part I of .ai/specs/2026-11-19-part-number-display.md: which part numbers
-- customer documents print. Each line stores its choice. A null choice is a
-- legacy line: it prints as its surface printed before this migration.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "customerPartNumberDisplay" "partNumberDisplay" NOT NULL DEFAULT 'Ours First';

-- Null: the company default applies to a new line.
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";

ALTER TABLE "quoteLine" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";
ALTER TABLE "salesInvoiceLine" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";
ALTER TABLE "shipmentLine" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";

-- The order line also keeps a copy of the customer part number from when it
-- was saved. Null on every line that exists now; those lines keep the live
-- cross-reference.
ALTER TABLE "salesOrderLine"
  ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay",
  ADD COLUMN IF NOT EXISTS "customerPartId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerPartRevision" TEXT;

-- Fills a new line's display choice from its document's customer: the
-- customer's override, else the company default. A line whose document has no
-- customer stays null. A backup load (app.backup_load) brings its own values,
-- so it skips it. PL/pgSQL plans
-- each statement when it first runs, per trigger table, so each branch reads
-- only its own table's NEW. SECURITY DEFINER so a caller who may write the
-- line gets the stamp even when RLS hides the customer or the settings row.
CREATE OR REPLACE FUNCTION stamp_line_customer_part_number_display()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id TEXT;
BEGIN
  IF NEW."partNumberDisplay" IS NOT NULL
    OR current_setting('app.backup_load', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'quoteLine' THEN
    SELECT d."customerId" INTO v_customer_id FROM "quote" d
    WHERE d."id" = NEW."quoteId" AND d."companyId" = NEW."companyId";
  ELSIF TG_TABLE_NAME = 'salesOrderLine' THEN
    SELECT d."customerId" INTO v_customer_id FROM "salesOrder" d
    WHERE d."id" = NEW."salesOrderId" AND d."companyId" = NEW."companyId";
  ELSIF TG_TABLE_NAME = 'salesInvoiceLine' THEN
    SELECT d."customerId" INTO v_customer_id FROM "salesInvoice" d
    WHERE d."id" = NEW."invoiceId" AND d."companyId" = NEW."companyId";
  ELSIF TG_TABLE_NAME = 'shipmentLine' THEN
    SELECT d."customerId" INTO v_customer_id FROM "shipment" d
    WHERE d."id" = NEW."shipmentId" AND d."companyId" = NEW."companyId";
  END IF;
  IF v_customer_id IS NULL THEN
    RETURN NEW;
  END IF;
  NEW."partNumberDisplay" := COALESCE(
    (SELECT c."partNumberDisplay" FROM "customer" c
      WHERE c."id" = v_customer_id AND c."companyId" = NEW."companyId"),
    (SELECT s."customerPartNumberDisplay" FROM "companySettings" s
      WHERE s."id" = NEW."companyId")
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "quoteLine_stamp_part_number_display" ON "quoteLine";
CREATE TRIGGER "quoteLine_stamp_part_number_display"
  BEFORE INSERT ON "quoteLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_line_customer_part_number_display();

DROP TRIGGER IF EXISTS "salesOrderLine_stamp_part_number_display" ON "salesOrderLine";
CREATE TRIGGER "salesOrderLine_stamp_part_number_display"
  BEFORE INSERT ON "salesOrderLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_line_customer_part_number_display();

DROP TRIGGER IF EXISTS "salesInvoiceLine_stamp_part_number_display" ON "salesInvoiceLine";
CREATE TRIGGER "salesInvoiceLine_stamp_part_number_display"
  BEFORE INSERT ON "salesInvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_line_customer_part_number_display();

DROP TRIGGER IF EXISTS "shipmentLine_stamp_part_number_display" ON "shipmentLine";
CREATE TRIGGER "shipmentLine_stamp_part_number_display"
  BEFORE INSERT ON "shipmentLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_line_customer_part_number_display();

-- A new order line copies the customer part number of its item for the
-- order's customer, unless the insert sets one. An item change copies it
-- again, unless the same write sets the number.
CREATE OR REPLACE FUNCTION copy_sales_order_line_customer_part()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_part TEXT;
  v_revision TEXT;
BEGIN
  IF current_setting('app.backup_load', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."customerPartId" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."itemId" IS NOT DISTINCT FROM OLD."itemId"
    OR NEW."customerPartId" IS DISTINCT FROM OLD."customerPartId"
  ) THEN
    RETURN NEW;
  END IF;
  SELECT cp."customerPartId", cp."customerPartRevision"
    INTO v_part, v_revision
  FROM "salesOrder" so
  JOIN "customerPartToItem" cp
    ON cp."customerId" = so."customerId"
   AND cp."itemId" = NEW."itemId"
   AND cp."companyId" = so."companyId"
  WHERE so."id" = NEW."salesOrderId" AND so."companyId" = NEW."companyId";
  NEW."customerPartId" := v_part;
  NEW."customerPartRevision" := v_revision;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "salesOrderLine_copy_customer_part" ON "salesOrderLine";
CREATE TRIGGER "salesOrderLine_copy_customer_part"
  BEFORE INSERT OR UPDATE OF "itemId" ON "salesOrderLine"
  FOR EACH ROW EXECUTE FUNCTION copy_sales_order_line_customer_part();

-- A customer change gives every line that has a display choice the new
-- customer's value. A legacy line (null) keeps its null. On a quote and a sales
-- order, every line also takes the new customer's part number, so the document
-- never prints another customer's numbers, and a quote converted afterwards
-- does not carry them onto its order. A line whose values do not change is not
-- written, so it gets no audit entry.
CREATE OR REPLACE FUNCTION restamp_customer_part_number_display()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_display "partNumberDisplay";
  v_user TEXT := COALESCE(NEW."updatedBy", NEW."createdBy");
BEGIN
  IF NEW."customerId" IS NULL
    OR current_setting('app.backup_load', true) = 'on' THEN
    RETURN NULL;
  END IF;
  v_display := COALESCE(
    (SELECT c."partNumberDisplay" FROM "customer" c
      WHERE c."id" = NEW."customerId" AND c."companyId" = NEW."companyId"),
    (SELECT s."customerPartNumberDisplay" FROM "companySettings" s
      WHERE s."id" = NEW."companyId")
  );
  IF TG_TABLE_NAME = 'quote' THEN
    UPDATE "quoteLine" l
    SET "partNumberDisplay" = n."partNumberDisplay",
        "customerPartId" = n."customerPartId",
        "customerPartRevision" = n."customerPartRevision",
        "updatedBy" = v_user,
        "updatedAt" = NOW()
    FROM (
      SELECT q."id",
        CASE WHEN q."partNumberDisplay" IS NULL THEN NULL ELSE v_display END
          AS "partNumberDisplay",
        cp."customerPartId",
        cp."customerPartRevision"
      FROM "quoteLine" q
      LEFT JOIN "customerPartToItem" cp
        ON cp."customerId" = NEW."customerId"
       AND cp."itemId" = q."itemId" AND cp."companyId" = q."companyId"
      WHERE q."quoteId" = NEW."id" AND q."companyId" = NEW."companyId"
    ) n
    WHERE l."id" = n."id" AND l."companyId" = NEW."companyId"
      AND (l."partNumberDisplay" IS DISTINCT FROM n."partNumberDisplay"
        OR l."customerPartId" IS DISTINCT FROM n."customerPartId"
        OR l."customerPartRevision" IS DISTINCT FROM n."customerPartRevision");
  ELSIF TG_TABLE_NAME = 'salesOrder' THEN
    UPDATE "salesOrderLine" l
    SET "partNumberDisplay" = n."partNumberDisplay",
        "customerPartId" = n."customerPartId",
        "customerPartRevision" = n."customerPartRevision",
        "updatedBy" = v_user,
        "updatedAt" = NOW()
    FROM (
      SELECT o."id",
        CASE WHEN o."partNumberDisplay" IS NULL THEN NULL ELSE v_display END
          AS "partNumberDisplay",
        cp."customerPartId",
        cp."customerPartRevision"
      FROM "salesOrderLine" o
      LEFT JOIN "customerPartToItem" cp
        ON cp."customerId" = NEW."customerId"
       AND cp."itemId" = o."itemId" AND cp."companyId" = o."companyId"
      WHERE o."salesOrderId" = NEW."id" AND o."companyId" = NEW."companyId"
    ) n
    WHERE l."id" = n."id" AND l."companyId" = NEW."companyId"
      AND (l."partNumberDisplay" IS DISTINCT FROM n."partNumberDisplay"
        OR l."customerPartId" IS DISTINCT FROM n."customerPartId"
        OR l."customerPartRevision" IS DISTINCT FROM n."customerPartRevision");
  ELSIF TG_TABLE_NAME = 'salesInvoice' THEN
    UPDATE "salesInvoiceLine"
    SET "partNumberDisplay" = v_display, "updatedBy" = v_user, "updatedAt" = NOW()
    WHERE "invoiceId" = NEW."id" AND "companyId" = NEW."companyId"
      AND "partNumberDisplay" IS NOT NULL
      AND "partNumberDisplay" IS DISTINCT FROM v_display;
  ELSIF TG_TABLE_NAME = 'shipment' THEN
    UPDATE "shipmentLine"
    SET "partNumberDisplay" = v_display, "updatedBy" = v_user, "updatedAt" = NOW()
    WHERE "shipmentId" = NEW."id" AND "companyId" = NEW."companyId"
      AND "partNumberDisplay" IS NOT NULL
      AND "partNumberDisplay" IS DISTINCT FROM v_display;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "quote_restamp_part_number_display" ON "quote";
CREATE TRIGGER "quote_restamp_part_number_display"
  AFTER UPDATE OF "customerId" ON "quote"
  FOR EACH ROW WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION restamp_customer_part_number_display();

DROP TRIGGER IF EXISTS "salesOrder_restamp_part_number_display" ON "salesOrder";
CREATE TRIGGER "salesOrder_restamp_part_number_display"
  AFTER UPDATE OF "customerId" ON "salesOrder"
  FOR EACH ROW WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION restamp_customer_part_number_display();

DROP TRIGGER IF EXISTS "salesInvoice_restamp_part_number_display" ON "salesInvoice";
CREATE TRIGGER "salesInvoice_restamp_part_number_display"
  AFTER UPDATE OF "customerId" ON "salesInvoice"
  FOR EACH ROW WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION restamp_customer_part_number_display();

DROP TRIGGER IF EXISTS "shipment_restamp_part_number_display" ON "shipment";
CREATE TRIGGER "shipment_restamp_part_number_display"
  AFTER UPDATE OF "customerId" ON "shipment"
  FOR EACH ROW WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION restamp_customer_part_number_display();

-- The 4 line views grow by the new table columns in the middle ("x".*),
-- which CREATE OR REPLACE cannot do, so they are dropped and created. No view
-- or function depends on them. Each body is the newest one, changed only as
-- the comments say.

-- quoteLines: from 20260811123619_widen-sales-production-scale.sql.
DROP VIEW IF EXISTS "quoteLines";
CREATE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost"
  FROM "quoteLine" ql
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);

-- salesOrderLines: from 20261117063412_delivery-date-check.sql. "sl".* now
-- carries the line copy, so the live cross-reference takes the FromCustomer
-- names.
DROP VIEW IF EXISTS "salesOrderLines";
CREATE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId" AS "customerPartIdFromCustomer",
    cp."customerPartRevision" AS "customerPartRevisionFromCustomer",
    so."orderDate",
    so."customerId",
    so."salesOrderId" as "salesOrderReadableId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

-- salesInvoiceLines: from 20261006221401_sales-invoice-discount-and-ship-to.sql.
-- "customerPartToItem" is unique on ("customerId", "itemId"), so its join
-- adds no row.
DROP VIEW IF EXISTS "salesInvoiceLines";
CREATE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    -- The order line's own copy, else the live cross-reference; the pair
    -- stays together.
    CASE WHEN NULLIF(TRIM(sol."customerPartId"), '') IS NOT NULL THEN sol."customerPartId" ELSE cp."customerPartId" END AS "customerPartId",
    CASE WHEN NULLIF(TRIM(sol."customerPartId"), '') IS NOT NULL THEN sol."customerPartRevision" ELSE cp."customerPartRevision" END AS "customerPartRevision",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesInvoiceLine" sl
  INNER JOIN "salesInvoice" si ON si.id = sl."invoiceId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
  LEFT JOIN "salesOrderLine" sol ON sol.id = sl."salesOrderLineId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = si."customerId" AND cp."itemId" = i.id
);

-- shipmentLines: from 20260417000300_storage-unit-recreate-dependents.sql.
DROP VIEW IF EXISTS "shipmentLines";
CREATE VIEW "shipmentLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description",
    -- A sales order shipment prints the order line's customer part number,
    -- else the shipment customer's cross-reference.
    CASE WHEN NULLIF(TRIM(sol."customerPartId"), '') IS NOT NULL THEN sol."customerPartId" ELSE cp."customerPartId" END AS "customerPartId",
    CASE WHEN NULLIF(TRIM(sol."customerPartId"), '') IS NOT NULL THEN sol."customerPartRevision" ELSE cp."customerPartRevision" END AS "customerPartRevision"
  FROM "shipmentLine" sl
  INNER JOIN "item" i ON i."id" = sl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "shipment" s ON s.id = sl."shipmentId"
  LEFT JOIN "salesOrderLine" sol
    ON s."sourceDocument" = 'Sales Order' AND sol.id = sl."lineId"
  LEFT JOIN "customerPartToItem" cp
    ON cp."customerId" = s."customerId" AND cp."itemId" = sl."itemId";

-- customers: from 20260521124731_supplier-customer-readable-id.sql, with the
-- override appended last so the view keeps its dependents.
CREATE OR REPLACE VIEW "customers" WITH(SECURITY_INVOKER=true) AS
  SELECT
    c.id,
    c."readableId",
    c.name,
    c."customerTypeId",
    c."customerStatusId",
    ctx."taxId",
    c."accountManagerId",
    c.logo,
    c.assignee,
    c."taxPercent",
    c."tags",
    c.website,
    c."companyId",
    c."createdAt",
    c."createdBy",
    c."updatedAt",
    c."updatedBy",
    c."customFields",
    c."currencyCode",
    c."salesContactId",
    c."defaultCc",
    ctx."vatNumber",
    ctx."eori",
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration",
          CASE
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
        '{}'::jsonb
      )
      FROM "externalIntegrationMapping" eim
      WHERE eim."entityType" = 'customer' AND eim."entityId" = c.id
    ) AS "externalId",
    ct.name AS "type",
    cs.name AS "status",
    so.count AS "orderCount",
    pc."workPhone" AS "phone",
    pc."fax" AS "fax",
    c."partNumberDisplay"
  FROM "customer" c
  LEFT JOIN "customerTax" ctx ON ctx."customerId" = c.id
  LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
  LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId"
  LEFT JOIN (
    SELECT
      "customerId",
      COUNT(*) AS "count"
    FROM "salesOrder"
    GROUP BY "customerId"
  ) so ON so."customerId" = c.id
  LEFT JOIN (
    SELECT DISTINCT ON (cc."customerId")
      cc."customerId",
      co."workPhone",
      co."fax"
    FROM "customerContact" cc
    INNER JOIN "contact" co ON co.id = cc."contactId"
    ORDER BY cc."customerId"
  ) pc ON pc."customerId" = c.id;
