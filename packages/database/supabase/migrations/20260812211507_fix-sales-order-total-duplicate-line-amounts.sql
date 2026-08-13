-- Fix "salesOrders"."orderTotal" dropping lines whose computed totals are equal.
--
-- The lateral that aggregates line data also LEFT JOINs "job" (a line can have
-- several jobs), so every line-level aggregate in it has to survive that
-- fan-out. "orderTotal" did so with sum(DISTINCT <line total>) — but DISTINCT
-- dedupes by VALUE, not by line: an order with two different lines that happen
-- to compute to the same amount (e.g. two items at 10 × $50 each) counts
-- that amount ONCE. The list page, dashboard KPI chart, and sales funnel all
-- read this column, so they understated such orders while the order detail
-- page and PDF (which sum the lines in the app) showed the correct total.
--
-- Fix: compute the total in its own lateral over "salesOrderLine" alone — no
-- job fan-out, so a plain sum() is correct. Everything else is forked verbatim
-- from 20260807011742_lateralize-order-list-views.sql (the newest definition).
-- The extra lateral is one index scan on "salesOrderLine"("salesOrderId") per
-- output row, evaluated per page row like the existing one (see the
-- parameterization notes in 20260807011742).
--
-- Semantics preserved for orders with no lines: sum() over an empty set is
-- NULL, so "orderTotal" stays NULL there, exactly as before.

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
