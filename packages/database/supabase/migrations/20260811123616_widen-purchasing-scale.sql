-- Widen the purchasing-side value columns that still clamp scale below the
-- app's internal precision, so entered prices, rates, and factors are stored
-- exactly as validated. Generated price columns that reference the retyped
-- columns must be dropped and re-added (bodies forked verbatim from
-- 20250807094441 / 20250204164256); dependent views are dropped and recreated
-- from their newest definitions.

DROP VIEW IF EXISTS "openPurchaseOrderLines";
DROP VIEW IF EXISTS "purchaseOrders";
DROP VIEW IF EXISTS "purchaseOrderLines";
DROP VIEW IF EXISTS "purchaseInvoices";
DROP VIEW IF EXISTS "purchaseInvoiceLines";
DROP VIEW IF EXISTS "receiptLines";
DROP VIEW IF EXISTS "supplierQuotes";
DROP VIEW IF EXISTS "supplierQuoteLines";
DROP VIEW IF EXISTS "purchasingRfqLines";
DROP VIEW IF EXISTS "supplierProcesses";

-- Column-list triggers (UPDATE OF "exchangeRate") pin the column type; drop
-- and recreate around the retype (DDL captured verbatim from the live schema).
DROP TRIGGER IF EXISTS "update_purchase_order_line_price_exchange_rate_trigger" ON "purchaseOrder";
DROP TRIGGER IF EXISTS "update_purchase_invoice_line_price_exchange_rate_trigger" ON "purchaseInvoice";
DROP TRIGGER IF EXISTS "update_supplier_quote_line_price_exchange_rate_trigger" ON "supplierQuote";

-- purchaseOrderLine ---------------------------------------------------------

ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "taxAmount";

ALTER TABLE "purchaseOrderLine"
  ALTER COLUMN "conversionFactor" TYPE NUMERIC,
  ALTER COLUMN "exchangeRate" TYPE NUMERIC,
  ALTER COLUMN "setupPrice" TYPE NUMERIC;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "extendedPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END * "purchaseQuantity"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "shippingCost" NUMERIC GENERATED ALWAYS AS (
  "supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "taxAmount" NUMERIC GENERATED ALWAYS AS (
  "supplierTaxAmount" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

-- purchaseInvoiceLine -------------------------------------------------------

ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "taxAmount";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "totalAmount";

ALTER TABLE "purchaseInvoiceLine"
  ALTER COLUMN "conversionFactor" TYPE NUMERIC,
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "extendedPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END * "quantity"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "shippingCost" NUMERIC GENERATED ALWAYS AS (
  "supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "taxAmount" NUMERIC GENERATED ALWAYS AS (
  "supplierTaxAmount" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "totalAmount" NUMERIC GENERATED ALWAYS AS (
  ("supplierUnitPrice" * "quantity" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END) +
  ("supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END) +
  ("supplierTaxAmount" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END)
) STORED;

-- supplierQuoteLinePrice ----------------------------------------------------

ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "taxAmount";

ALTER TABLE "supplierQuoteLinePrice"
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "extendedPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END * "quantity"
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "shippingCost" NUMERIC GENERATED ALWAYS AS (
  "supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "taxAmount" NUMERIC GENERATED ALWAYS AS (
  "supplierTaxAmount" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

-- Headers and the rest ------------------------------------------------------

ALTER TABLE "purchaseOrder"
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "purchaseInvoice"
  ALTER COLUMN "subtotal" TYPE NUMERIC,
  ALTER COLUMN "totalDiscount" TYPE NUMERIC,
  ALTER COLUMN "totalAmount" TYPE NUMERIC,
  ALTER COLUMN "totalTax" TYPE NUMERIC,
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "purchaseInvoicePriceChange"
  ALTER COLUMN "previousPrice" TYPE NUMERIC,
  ALTER COLUMN "newPrice" TYPE NUMERIC,
  ALTER COLUMN "previousQuantity" TYPE NUMERIC,
  ALTER COLUMN "newQuantity" TYPE NUMERIC;

ALTER TABLE "receiptLine"
  ALTER COLUMN "conversionFactor" TYPE NUMERIC,
  ALTER COLUMN "unitPrice" TYPE NUMERIC,
  ALTER COLUMN "orderQuantity" TYPE NUMERIC,
  ALTER COLUMN "outstandingQuantity" TYPE NUMERIC,
  ALTER COLUMN "receivedQuantity" TYPE NUMERIC;

-- supplierPart."unitPrice" was born clamped to 2 decimals and a later widening
-- used ADD COLUMN IF NOT EXISTS, a no-op wherever the column already existed,
-- so distributor prices silently rounded on entry (0.164 -> 0.16). The
-- price-break rows are the same price on the same screen, so they follow.
ALTER TABLE "supplierPart"
  ALTER COLUMN "unitPrice" TYPE NUMERIC;

ALTER TABLE "supplierPartPrice"
  ALTER COLUMN "unitPrice" TYPE NUMERIC,
  ALTER COLUMN "quantity" TYPE NUMERIC;

ALTER TABLE "supplierQuote"
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "supplierQuoteLine"
  ALTER COLUMN "quantity" TYPE NUMERIC[] USING "quantity"::NUMERIC[];

ALTER TABLE "purchasingRfqLine"
  ALTER COLUMN "quantity" TYPE NUMERIC[] USING "quantity"::NUMERIC[];

ALTER TABLE "supplierProcess"
  ALTER COLUMN "minimumCost" TYPE NUMERIC;

-- Recreate views (each forked verbatim from its newest definition) ----------

-- Forked from 20260708204214_partial-gr-visibility-and-short-close.sql
CREATE OR REPLACE VIEW "openPurchaseOrderLines" WITH (security_invoker=true) AS (
  SELECT
    pol."id",
    pol."purchaseOrderId",
    po."purchaseOrderId" as "purchaseOrderReadableId",
    po."supplierId",
    pol."itemId",
    pol."quantityToReceive" * pol."conversionFactor" AS "quantityToReceive",
    i."unitOfMeasureCode",
    pol."purchaseOrderLineType",
    pol."requiredDate" AS "dueDate",
    pol."companyId",
    pol."locationId",
    po."orderDate",
    po."status",
    COALESCE(pol."promisedDate", pod."receiptPromisedDate") AS "promisedDate",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime"
  FROM "purchaseOrderLine" pol
  INNER JOIN "purchaseOrder" po ON pol."purchaseOrderId" = po."id"
  INNER JOIN "purchaseOrderDelivery" pod ON pod."id" = po."id"
  INNER JOIN "item" i ON pol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE
    pol."purchaseOrderLineType" != 'Service'
    AND po."status" IN ('To Receive', 'To Receive and Invoice', 'Planned')
    AND pol."receivedComplete" = false
);

-- Forked from 20260807011742_lateralize-order-list-views.sql
CREATE OR REPLACE VIEW "purchaseOrders" WITH (security_invoker = true) AS
 SELECT p.id,
    p."purchaseOrderId",
    p."revisionId",
    p.status,
    p."orderDate",
    p."supplierId",
    p."supplierLocationId",
    p."supplierContactId",
    p."supplierReference",
    p.assignee,
    p."companyId",
    p."closedAt",
    p."closedBy",
    p."customFields",
    p."createdAt",
    p."createdBy",
    p."updatedAt",
    p."updatedBy",
    p."currencyCode",
    p."exchangeRate",
    p."exchangeRateUpdatedAt",
    p.tags,
    p."internalNotes",
    p."externalNotes",
    p."supplierInteractionId",
    p."purchaseOrderType",
    p."jobId",
    p."jobReadableId",
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + pd."supplierShippingCost" /
        CASE
            WHEN p."exchangeRate" = 0::numeric THEN 1::numeric
            ELSE p."exchangeRate"
        END AS "orderTotal",
    COALESCE(pl."receivableQuantity", 0::numeric) AS "receivableQuantity",
    COALESCE(pl."receivedQuantity", 0::numeric) AS "receivedQuantity",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    pd."locationId",
    pd."supplierShippingCost",
    pd.incoterm,
    pd."incotermLocation",
    u."fullName" AS "createdByFullName",
    u.email AS "createdByEmail",
    u.phone AS "createdByPhone",
    ua."fullName" AS "assigneeFullName",
    ua.email AS "assigneeEmail",
    ua.phone AS "assigneePhone",
    uam."fullName" AS "accountManagerFullName",
    uam.email AS "accountManagerEmail",
    uam.phone AS "accountManagerPhone"
   FROM "purchaseOrder" p
     LEFT JOIN LATERAL ( SELECT
            min(
                CASE
                    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
                    ELSE i."thumbnailPath"
                END) AS "thumbnailPath",
            sum(COALESCE(pol."purchaseQuantity", 0::numeric) * COALESCE(pol."unitPrice", 0::numeric) + COALESCE(pol."shippingCost", 0::numeric) + COALESCE(pol."taxAmount", 0::numeric)) AS "orderTotal",
            sum(
                CASE
                    WHEN pol."purchaseOrderLineType" <> ALL (ARRAY['Comment'::"purchaseOrderLineType", 'G/L Account'::"purchaseOrderLineType"]) THEN COALESCE(pol."purchaseQuantity", 0::numeric)
                    ELSE 0::numeric
                END) AS "receivableQuantity",
            sum(
                CASE
                    WHEN pol."purchaseOrderLineType" <> ALL (ARRAY['Comment'::"purchaseOrderLineType", 'G/L Account'::"purchaseOrderLineType"]) THEN COALESCE(pol."quantityReceived", 0::numeric)
                    ELSE 0::numeric
                END) AS "receivedQuantity",
            min(i.type) AS "itemType"
           FROM "purchaseOrderLine" pol
             LEFT JOIN item i ON i.id = pol."itemId"
             LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
          WHERE pol."purchaseOrderId" = p.id) pl ON true
     LEFT JOIN "purchaseOrderDelivery" pd ON pd.id = p.id
     LEFT JOIN "shippingTerm" st ON st.id = pd."shippingTermId"
     LEFT JOIN "purchaseOrderPayment" pp ON pp.id = p.id
     LEFT JOIN "user" u ON u.id = p."createdBy"
     LEFT JOIN "user" ua ON ua.id = p.assignee
     LEFT JOIN supplier s ON s.id = p."supplierId"
     LEFT JOIN "user" uam ON uam.id = s."accountManagerId";

-- Forked from 20260726234512_drop-requires-inspection.sql
CREATE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
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
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
);

-- Forked from 20260702224219_fix-ar-ap-legacy-paid.sql
CREATE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      s."targetPurchaseInvoiceId",
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS amount,
      MAX(s."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" s
    LEFT JOIN "payment" p ON p."id" = s."paymentId"
    LEFT JOIN "memo" m ON m."id" = s."memoId"
    LEFT JOIN "payment" vp ON vp."id" = s."appliedViaPaymentId"
    WHERE s."targetPurchaseInvoiceId" IS NOT NULL
      AND (
        (s."paymentId" IS NOT NULL AND p."status" = 'Posted')
        OR (
          s."memoId" IS NOT NULL AND m."status" = 'Posted'
          AND (s."appliedViaPaymentId" IS NULL OR vp."status" = 'Posted')
        )
      )
    GROUP BY s."targetPurchaseInvoiceId"
  )
  SELECT
    pi."id",
    pi."invoiceId",
    pi."supplierId",
    pi."invoiceSupplierId",
    pi."supplierInteractionId",
    pi."supplierReference",
    pi."invoiceSupplierContactId",
    pi."invoiceSupplierLocationId",
    pi."locationId",
    pi."postingDate",
    pi."dateIssued",
    pi."dateDue",
    CASE
      WHEN pi."status" = 'Paid' THEN pi."datePaid"
      WHEN COALESCE(s.amount, 0) > 0
        AND (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) < 0.01 THEN COALESCE(s."lastSettlementDate", pi."datePaid")
      ELSE pi."datePaid"
    END AS "datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    COALESCE(pl."subtotal", 0) AS "subtotal",
    pi."totalDiscount",
    (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) AS "totalAmount",
    COALESCE(pl."totalTax", 0) AS "totalTax",
    CASE
      WHEN pi."status" = 'Paid' THEN 0
      WHEN COALESCE(s.amount, 0) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) < 0.01 THEN 0
      ELSE ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0))
    END AS "balance",
    pi."assignee",
    pi."createdBy",
    pi."createdAt",
    pi."updatedBy",
    pi."updatedAt",
    pi."internalNotes",
    pi."customFields",
    pi."companyId",
    pl."thumbnailPath",
    pl."itemType",
    COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
    CASE
      WHEN pi."status" IN ('Draft','Pending','Voided','Return','Debit Note Issued') THEN pi."status"::TEXT
      WHEN pi."status" = 'Paid' THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0
        AND (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) < 0.01 THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0 THEN 'Partially Paid'
      WHEN pi."dateDue" < CURRENT_DATE AND pi."status" = 'Open' THEN 'Overdue'
      ELSE pi."status"::TEXT
    END AS status,
    pt."name" AS "paymentTermName",
    pi."status" AS "baseStatus"
  FROM "purchaseInvoice" pi
  LEFT JOIN (
    SELECT
      pol."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        COALESCE(pol."quantity", 0)*COALESCE(pol."unitPrice", 0) + COALESCE(pol."shippingCost", 0)
      ) AS "subtotal",
      SUM(COALESCE(pol."taxAmount", 0)) AS "totalTax",
      SUM(
        COALESCE(pol."quantity", 0)*COALESCE(pol."unitPrice", 0) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)
      ) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseInvoiceLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."invoiceId"
  ) pl ON pl."invoiceId" = pi."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId"
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id"
  LEFT JOIN settled s ON s."targetPurchaseInvoiceId" = pi."id";

-- Forked from 20260524143827_fixed-assets.sql
CREATE OR REPLACE VIEW "purchaseInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i."readableIdWithRevision" as "itemReadableId",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    sp."supplierPartId",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "purchaseInvoiceLine" pl
  INNER JOIN "purchaseInvoice" pi ON pi.id = pl."invoiceId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = pi."supplierId" AND sp."itemId" = i.id
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
);

-- Forked from 20260417000300_storage-unit-recreate-dependents.sql
CREATE OR REPLACE VIEW "receiptLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    rl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "receiptLine" rl
  INNER JOIN "item" i ON i."id" = rl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";

-- Forked from 20251127000000_supplier_quote_updates.sql
CREATE OR REPLACE VIEW "supplierQuotes"
WITH
  (SECURITY_INVOKER = true) AS
SELECT
  q.*,
  ql."thumbnailPath",
  ql."itemType"
FROM
  "supplierQuote" q
  LEFT JOIN (
    SELECT
      "supplierQuoteId",
      MIN(
        CASE
          WHEN i."thumbnailPath" IS NULL
          AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
          ELSE i."thumbnailPath"
        END
      ) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM
      "supplierQuoteLine"
      INNER JOIN "item" i ON i."id" = "supplierQuoteLine"."itemId"
      LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY
      "supplierQuoteId"
  ) ql ON ql."supplierQuoteId" = q.id;

-- Forked from 20260513120000_line-item-sort-order.sql
CREATE OR REPLACE VIEW "supplierQuoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."readableIdWithRevision" as "itemReadableId",
    i."type" as "itemType",
    COALESCE(i."thumbnailPath", mu."thumbnailPath") as "thumbnailPath",
    ic."unitCost" as "unitCost",
    a."name" as "accountName"
  FROM "supplierQuoteLine" ql
  LEFT JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "account" a ON a.id = ql."accountId"
);

-- Forked from 20260115143000_purchasing-rfq.sql
CREATE OR REPLACE VIEW "purchasingRfqLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    prl.*,
    i."name" as "itemName",
    i."readableId" AS "itemReadableId",
    i."type" AS "itemType",
    i."thumbnailPath",
    mu."modelPath"
  FROM "purchasingRfqLine" prl
  LEFT JOIN "item" i ON i.id = prl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";

-- Forked from 20241115011318_remove-supplier-process-unit-cost.sql
CREATE VIEW "supplierProcesses" WITH(SECURITY_INVOKER=true) AS
  SELECT
    sp.*,
    p.name as "processName"
  FROM "supplierProcess" sp
  INNER JOIN "process" p ON sp."processId" = p.id;

-- Recreate the exchange-rate sync triggers
CREATE TRIGGER update_purchase_order_line_price_exchange_rate_trigger
AFTER UPDATE OF "exchangeRate" ON "purchaseOrder"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_purchase_order_line_price_exchange_rate();

CREATE TRIGGER update_purchase_invoice_line_price_exchange_rate_trigger
AFTER UPDATE OF "exchangeRate" ON "purchaseInvoice"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_purchase_invoice_line_price_exchange_rate();

CREATE TRIGGER update_supplier_quote_line_price_exchange_rate_trigger
AFTER UPDATE OF "exchangeRate" ON "supplierQuote"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_supplier_quote_line_price_exchange_rate();
