-- Re-land 20260812211507_fix-sales-order-total-duplicate-line-amounts.
--
-- That fix was silently reverted on the remotes by
-- 20260811123619_widen-sales-production-scale.sql: authored in parallel, it
-- recreates "salesOrders" from the pre-fix body (its fork comment says
-- 20260807011742), and its BACKDATED timestamp meant `db push --include-all`
-- applied it AFTER the fix. The fix's version stayed recorded in
-- supabase_migrations while its effect was gone — see .ai/lessons.md
-- "Backdated migration timestamps break remote deploys".
--
-- The bug being re-fixed: "orderTotal" was computed with
-- sum(DISTINCT <line total>) inside the lateral that also LEFT JOINs "job".
-- The DISTINCT cancels the job-join fan-out but dedupes by VALUE, not by
-- line, so an order with two different lines that compute to the same amount
-- (e.g. two items at 10 × $50 each) counts that amount once — understating
-- the orders list, the dashboard KPI chart, and the sales funnel, while the
-- detail page and PDF (app-side plain sums) stay correct.
--
-- Fix (unchanged from 20260812211507): compute the total in its own lateral
-- over "salesOrderLine" alone — no job fan-out, so a plain sum() is correct.
-- Forked verbatim from the NEWEST "salesOrders" definition (20260811123619,
-- whose body is byte-identical to 20260807011742). Orders with no lines keep
-- returning NULL (sum() over an empty set), exactly as before.

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
    tot."orderTotal" + COALESCE(ss."shippingCost", 0::numeric) AS "orderTotal",
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
     LEFT JOIN LATERAL ( SELECT
            sum((1::numeric + COALESCE(sol."taxPercent", 0::numeric)) * (COALESCE(sol."saleQuantity", 0::numeric) * COALESCE(sol."unitPrice", 0::numeric) + COALESCE(sol."shippingCost", 0::numeric) + COALESCE(sol."addOnCost", 0::numeric)) + COALESCE(sol."nonTaxableAddOnCost", 0::numeric)) AS "orderTotal"
           FROM "salesOrderLine" sol
          WHERE sol."salesOrderId" = s.id) tot ON true
     LEFT JOIN "salesOrderShipment" ss ON ss.id = s.id
     LEFT JOIN "shippingTerm" st ON st.id = ss."shippingTermId"
     LEFT JOIN "salesOrderPayment" sp ON sp.id = s.id;
