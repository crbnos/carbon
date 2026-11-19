-- Part II of .ai/specs/2026-11-19-part-number-display.md: which part numbers a
-- purchase order line prints. Each line stores its choice. A null choice is a
-- legacy line: it prints as purchase orders printed before PR #2290.

-- The company default for new purchase order lines.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "supplierPartNumberDisplay" "partNumberDisplay" NOT NULL DEFAULT 'Theirs First';

-- Null: the company default applies to a new line.
ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";

-- Fills a new line's display choice from its order's supplier: the supplier's
-- override, else the company default. A dataset apply (app.dataset_apply)
-- and a backup load (app.backup_load) bring their own values, so it skips
-- them. SECURITY DEFINER so a caller who may write the line gets the stamp even
-- when RLS hides the supplier or the settings row. A trigger function is not
-- callable as an RPC.
CREATE OR REPLACE FUNCTION stamp_purchase_order_line_part_number_display()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."partNumberDisplay" IS NOT NULL
    OR current_setting('app.dataset_apply', true) = 'true'
    OR current_setting('app.backup_load', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW."partNumberDisplay" := COALESCE(
    (SELECT s."partNumberDisplay"
      FROM "purchaseOrder" po
      JOIN "supplier" s ON s."id" = po."supplierId" AND s."companyId" = po."companyId"
      WHERE po."id" = NEW."purchaseOrderId" AND po."companyId" = NEW."companyId"),
    (SELECT cs."supplierPartNumberDisplay" FROM "companySettings" cs
      WHERE cs."id" = NEW."companyId")
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "purchaseOrderLine_stamp_part_number_display" ON "purchaseOrderLine";
CREATE TRIGGER "purchaseOrderLine_stamp_part_number_display"
  BEFORE INSERT ON "purchaseOrderLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_purchase_order_line_part_number_display();

-- A new line copies its item's supplier part number for the order's supplier,
-- unless the insert sets one, so a later edit of the supplier part leaves the
-- order as it was. An item change copies it again, unless the same write sets
-- the number (the line form does).
CREATE OR REPLACE FUNCTION copy_purchase_order_line_supplier_part()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.dataset_apply', true) = 'true'
    OR current_setting('app.backup_load', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."supplierPartId" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."itemId" IS NOT DISTINCT FROM OLD."itemId"
    OR NEW."supplierPartId" IS DISTINCT FROM OLD."supplierPartId"
  ) THEN
    RETURN NEW;
  END IF;
  NEW."supplierPartId" := (
    SELECT sp."supplierPartId"
    FROM "purchaseOrder" po
    JOIN "supplierPart" sp
      ON sp."supplierId" = po."supplierId"
     AND sp."itemId" = NEW."itemId"
     AND sp."companyId" = po."companyId"
    WHERE po."id" = NEW."purchaseOrderId" AND po."companyId" = NEW."companyId"
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "purchaseOrderLine_copy_supplier_part" ON "purchaseOrderLine";
CREATE TRIGGER "purchaseOrderLine_copy_supplier_part"
  BEFORE INSERT OR UPDATE OF "itemId" ON "purchaseOrderLine"
  FOR EACH ROW EXECUTE FUNCTION copy_purchase_order_line_supplier_part();

-- A supplier change gives every line that has a display choice the new
-- supplier's value; a legacy line keeps its null. Every line also takes the new
-- supplier's part number, so an order never prints another supplier's numbers.
CREATE OR REPLACE FUNCTION restamp_supplier_part_number_display()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_display "partNumberDisplay";
  v_user TEXT := COALESCE(NEW."updatedBy", NEW."createdBy");
BEGIN
  IF current_setting('app.dataset_apply', true) = 'true'
    OR current_setting('app.backup_load', true) = 'on' THEN
    RETURN NULL;
  END IF;
  v_display := COALESCE(
    (SELECT s."partNumberDisplay" FROM "supplier" s
      WHERE s."id" = NEW."supplierId" AND s."companyId" = NEW."companyId"),
    (SELECT cs."supplierPartNumberDisplay" FROM "companySettings" cs
      WHERE cs."id" = NEW."companyId")
  );
  UPDATE "purchaseOrderLine" pl
  SET "partNumberDisplay" =
        CASE WHEN pl."partNumberDisplay" IS NULL THEN NULL ELSE v_display END,
      "supplierPartId" = (
        SELECT sp."supplierPartId" FROM "supplierPart" sp
        WHERE sp."supplierId" = NEW."supplierId"
          AND sp."itemId" = pl."itemId" AND sp."companyId" = pl."companyId"),
      "updatedBy" = v_user,
      "updatedAt" = NOW()
  WHERE pl."purchaseOrderId" = NEW."id" AND pl."companyId" = NEW."companyId";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "purchaseOrder_restamp_part_number_display" ON "purchaseOrder";
CREATE TRIGGER "purchaseOrder_restamp_part_number_display"
  AFTER UPDATE OF "supplierId" ON "purchaseOrder"
  FOR EACH ROW WHEN (OLD."supplierId" IS DISTINCT FROM NEW."supplierId")
  EXECUTE FUNCTION restamp_supplier_part_number_display();

-- "pl".* grows by one column in the middle of the view, which CREATE OR REPLACE
-- cannot do. No view or function depends on "purchaseOrderLines". Body from
-- 20261104063431_purchase-order-lines-filter-pushdown.sql, unchanged.
DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    sp."supplierPartId" as "supplierPartIdFromSupplier",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    jo."description" as "jobOperationDescription",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN LATERAL (
    SELECT c."unitCost" FROM "itemCost" c WHERE c."itemId" = i.id
    ORDER BY c."updatedAt" DESC NULLS LAST, c."createdAt" DESC
    LIMIT 1
  ) ic ON true
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "supplierPart" sp
    ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id AND sp."companyId" = so."companyId"
);

-- The supplier override, appended last so the view keeps its dependents. Body
-- from 20261111120200_supplier-stage.sql.
CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.id,
    s."readableId",
    s.name,
    s."supplierTypeId",
    s."supplierStatus" AS "status",
    stx."taxId",
    s."accountManagerId",
    s.logo,
    s.assignee,
    s."companyId",
    s."createdAt",
    s."createdBy",
    s."updatedAt",
    s."updatedBy",
    s."customFields",
    s."currencyCode",
    stx."vatNumber",
    stx."eori",
    s.website,
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
      WHERE eim."entityType" = 'supplier' AND eim."entityId" = s.id
    ) AS "externalId",
    s.tags,
    s."taxPercent",
    s."purchasingContactId",
    s.embedding,
    s."defaultCc",
    st.name AS "type",
    po.count AS "orderCount",
    p.count AS "partCount",
    pc."workPhone" AS "phone",
    pc.fax AS "fax",
    s."supplierStageId",
    ss.name AS "stage",
    s."partNumberDisplay"
  FROM "supplier" s
  LEFT JOIN "supplierTax" stx ON stx."supplierId" = s.id
  LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
  LEFT JOIN "supplierStage" ss ON ss.id = s."supplierStageId" AND ss."companyId" = s."companyId"
  LEFT JOIN (
    SELECT
      "supplierId",
      COUNT(*) AS "count"
    FROM "purchaseOrder"
    GROUP BY "supplierId"
  ) po ON po."supplierId" = s.id
  LEFT JOIN (
    SELECT
      "supplierId",
      COUNT(*) AS "count"
    FROM "supplierPart"
    GROUP BY "supplierId"
  ) p ON p."supplierId" = s.id
  LEFT JOIN (
    SELECT DISTINCT ON (sc."supplierId")
      sc."supplierId" AS id,
      co."workPhone",
      co."fax"
    FROM "supplierContact" sc
    INNER JOIN "contact" co ON co.id = sc."contactId"
    ORDER BY sc."supplierId", sc.id
  ) pc ON pc.id = s.id;
