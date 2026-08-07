-- Performance: make the sales-order list view parameterizable.
--
-- The view rolled its line totals up through
--   LEFT JOIN (SELECT ... GROUP BY "salesOrderId") x ON x."salesOrderId" = s.id
-- A subquery RTE with GROUP BY cannot be parameterized (only LATERAL can), and
-- the grouping key is the order id, not companyId -- so the caller's
-- .eq("companyId", ...) could not be pushed in. Postgres aggregated EVERY
-- tenant's order lines, then hash-joined the result down to the 100 rows the
-- page asked for.
--
-- Rewritten as LEFT JOIN LATERAL ... ON true, correlated on the order id, so
-- the aggregate is evaluated per qualifying order instead.
--
-- Semantics are preserved: an aggregate with no GROUP BY over an empty set
-- returns a single all-NULL row, which is exactly what the LEFT JOIN miss
-- produced before. Verified output-identical (md5 of every column, every row)
-- against 10k orders / 40k lines.
--
-- Measured with RLS enforced (as `authenticated`, claims held for the whole
-- transaction), page-1 query of 100 rows on that dataset:
--   salesOrders  ~3570 ms -> ~400 ms
--
-- NOT applied to `purchaseOrders`, which has the same shape. Measured, the
-- rewrite makes it ~7x SLOWER under RLS (~55 ms -> ~400 ms). Both views join
-- `item` inside the aggregate, and `item`'s RLS SELECT policy is an OR of three
-- predicates that cannot use an index, so each lateral invocation seq-scans the
-- whole `item` table -- 100 times per page instead of once. salesOrders still
-- wins because its bulk form was far worse (a SUM(DISTINCT ...) plus a jobs
-- array_agg over every tenant's lines); purchaseOrders' bulk form was already
-- cheap, so the per-row repetition dominates. Revisit if the `item` policy is
-- ever made index-friendly.
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
