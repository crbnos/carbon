-- When goods left the supplier and when the buyer expects them. Both are entered
-- by hand and are display only: MRP still dates supply from the promised date.
ALTER TABLE "purchaseOrderDelivery"
  ADD COLUMN "shippedDate" DATE,
  ADD COLUMN "expectedReceiptDate" DATE;

-- Off by default: a company that gets the promised date after it sends the order
-- keeps that flow.
ALTER TABLE "companySettings"
  ADD COLUMN "requirePromisedDateToFinalizePurchaseOrder" BOOLEAN NOT NULL DEFAULT false;

-- Replaced in place, new columns last: "searchLines" and "searchPurchaseOrders"
-- depend on this view's row type, so it cannot be dropped.
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
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
    uam.phone AS "accountManagerPhone",
    pd."shippedDate",
    pd."expectedReceiptDate"
   FROM "purchaseOrder" p
     LEFT JOIN LATERAL ( SELECT min(
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
