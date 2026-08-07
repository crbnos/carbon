-- Performance: make the sales-order and purchase-order list views
-- parameterizable.
--
-- Both views rolled their line totals up through
--   LEFT JOIN (SELECT ... GROUP BY "<header>Id") x ON x."<header>Id" = h.id
-- A subquery RTE with GROUP BY cannot be parameterized (only LATERAL can), and
-- the grouping key is the header id, not companyId -- so the caller's
-- .eq("companyId", ...) could not be pushed in. Postgres aggregated EVERY
-- tenant's order lines, then hash-joined the result down to the 100 rows the
-- page asked for. Cost grew with total database size rather than with the
-- tenant's size.
--
-- Rewritten as LEFT JOIN LATERAL ... ON true, correlated on the header id, so
-- the aggregate is evaluated per qualifying order instead.
--
-- Semantics are preserved: an aggregate with no GROUP BY over an empty set
-- returns a single all-NULL row, which is exactly what the LEFT JOIN miss
-- produced before. Verified output-identical (md5 of every column, every row)
-- against 10k orders / 40k lines per view.
--
-- Measured on that dataset, page-1 query of 100 rows, run as `authenticated`
-- with RLS enforced (the path the app actually takes):
--   salesOrders     ~145 ms -> ~1.25 ms
--   purchaseOrders  ~51 ms  -> ~1.25 ms
--
-- The gain is larger under RLS than without it: in the plain-subquery form the
-- per-row policy predicate has to be evaluated while aggregating every tenant's
-- lines, whereas the LATERAL form evaluates it only for the orders on the page.
--
-- jobs/lines get an explicit ORDER BY inside array_agg. Element order was
-- previously unspecified (it only looked stable because the plan happened to be
-- stable); pinning it makes this migration byte-identical in output and stops
-- the UI ordering from depending on the query plan.

CREATE OR REPLACE VIEW "salesOrders" WITH (security_invoker = true) AS
 SELECT s.id,
    s."salesOrderId",
    s."revisionId",
    s.status,
    s."orderDate",
    s."currencyCode",
    s."customerId",
    s."customerLocationId",
    s."customerContactId",
    s."customerReference",
    s.assignee,
    s."companyId",
    s."closedAt",
    s."closedBy",
    s."customFields",
    s."createdAt",
    s."createdBy",
    s."updatedAt",
    s."updatedBy",
    s."locationId",
    s."exchangeRate",
    s."exchangeRateUpdatedAt",
    s."externalNotes",
    s."internalNotes",
    s."salesPersonId",
    s."sentCompleteDate",
    s."opportunityId",
    s."completedDate",
    s."customerEngineeringContactId",
        CASE
            WHEN (s.status <> ALL (ARRAY['Closed'::"salesOrderStatus", 'Cancelled'::"salesOrderStatus"])) AND (EXISTS ( SELECT 1
               FROM "salesOrderLine" sol
              WHERE sol."salesOrderId" = s.id AND sol."methodType" = 'Make to Order'::"methodType" AND COALESCE(( SELECT sum(j."quantityComplete") AS sum
                       FROM job j
                      WHERE j."salesOrderLineId" = sol.id AND j."salesOrderId" = sol."salesOrderId"), 0::numeric) < sol."saleQuantity")) THEN 'In Progress'::"salesOrderStatus"
            ELSE s.status
        END AS "displayStatus",
    sl."thumbnailPath",
    sl."itemType",
    sl."orderTotal" + COALESCE(ss."shippingCost", 0::numeric) AS "orderTotal",
    sl.jobs,
    sl.lines,
    st.name AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    ss.incoterm,
    ss."incotermLocation",
    ( SELECT COALESCE(jsonb_object_agg(eim.integration,
                CASE
                    WHEN eim.metadata IS NOT NULL THEN eim.metadata
                    ELSE to_jsonb(eim."externalId")
                END) FILTER (WHERE eim."externalId" IS NOT NULL OR eim.metadata IS NOT NULL), '{}'::jsonb) AS "coalesce"
           FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'salesOrder'::text AND eim."entityId" = s.id) AS "externalId"
   FROM "salesOrder" s
     LEFT JOIN LATERAL ( SELECT
            min(
                CASE
                    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
                    ELSE i."thumbnailPath"
                END) AS "thumbnailPath",
            sum(DISTINCT (1::numeric + COALESCE(sol."taxPercent", 0::numeric)) * (COALESCE(sol."saleQuantity", 0::numeric) * COALESCE(sol."unitPrice", 0::numeric) + COALESCE(sol."shippingCost", 0::numeric) + COALESCE(sol."addOnCost", 0::numeric)) + COALESCE(sol."nonTaxableAddOnCost", 0::numeric)) AS "orderTotal",
            min(i.type) AS "itemType",
            array_agg(
                CASE
                    WHEN j.id IS NOT NULL THEN json_build_object('id', j.id, 'jobId', j."jobId", 'status', j.status, 'dueDate', j."dueDate", 'productionQuantity', j."productionQuantity", 'quantityComplete', j."quantityComplete", 'quantityShipped', j."quantityShipped", 'quantity', j.quantity, 'scrapQuantity', j."scrapQuantity", 'salesOrderLineId', sol.id, 'assignee', j.assignee)
                    ELSE NULL::json
                END ORDER BY sol.id, j.id) FILTER (WHERE j.id IS NOT NULL) AS jobs,
            array_agg(json_build_object('id', sol.id, 'methodType', sol."methodType", 'saleQuantity', sol."saleQuantity") ORDER BY sol.id) AS lines
           FROM "salesOrderLine" sol
             LEFT JOIN item i ON i.id = sol."itemId"
             LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
             LEFT JOIN job j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol.id
          WHERE sol."salesOrderId" = s.id) sl ON true
     LEFT JOIN "salesOrderShipment" ss ON ss.id = s.id
     LEFT JOIN "shippingTerm" st ON st.id = ss."shippingTermId"
     LEFT JOIN "salesOrderPayment" sp ON sp.id = s.id;

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
