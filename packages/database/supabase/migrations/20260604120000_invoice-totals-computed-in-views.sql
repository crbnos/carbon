-- =============================================================================
-- Compute invoice totals (subtotal, totalTax, totalAmount) in the invoice views
-- instead of relying on the stored header columns, which are set once at
-- creation and never updated -- so the API/MCP (which read these views) return
-- the correct, live values derived from the line items.
--
-- Replaces the earlier trigger/interceptor approach: the totals are now computed
-- on read in `salesInvoices` / `purchaseInvoices`. The backend getSalesInvoice/
-- getSalesInvoices (and purchase equivalents) already select from these views.
--
-- The stored salesInvoice/purchaseInvoice.{subtotal,totalTax,totalAmount} columns
-- are left in place (still read by the Xero sync) but are no longer the source
-- of truth for the API. Definitions (document currency, matching the existing
-- invoiceTotal/orderTotal): nonTaxableAddOnCost is untaxed; shipment-level
-- shipping is untaxed and added on top.
--   subtotal   = Σ (qty*unitPrice + addOnCost + nonTaxableAddOnCost + lineShipping)
--   totalTax   = Σ taxPercent * (qty*unitPrice + addOnCost + lineShipping)
--   totalAmount= subtotal + totalTax + shipmentShipping   (== invoiceTotal)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Unwind the interceptor approach (replaced by view computation).
-- -----------------------------------------------------------------------------

-- salesInvoiceLine: clear our after-interceptor (no before/after interceptors).
SELECT attach_event_trigger('salesInvoiceLine', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
DROP FUNCTION IF EXISTS sync_recompute_sales_invoice_tax(TEXT, TEXT, JSONB, JSONB);

-- purchaseInvoiceLine: restore just the price-change AFTER interceptor (drop ours).
SELECT attach_event_trigger(
  'purchaseInvoiceLine',
  ARRAY[]::TEXT[],
  ARRAY['sync_purchase_invoice_line_price_change']::TEXT[]
);
DROP FUNCTION IF EXISTS sync_recompute_purchase_invoice_tax(TEXT, TEXT, JSONB, JSONB);


-- -----------------------------------------------------------------------------
-- salesInvoices: compute subtotal / totalTax / totalAmount from the lines.
-- (si.* expanded to an explicit list so the computed columns replace the stored
-- ones. plain SUM, not SUM(DISTINCT) -- DISTINCT dropped identical line amounts.)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  SELECT
    si."id",
    si."invoiceId",
    si."status",
    si."customerId",
    si."customerReference",
    si."invoiceCustomerId",
    si."invoiceCustomerLocationId",
    si."invoiceCustomerContactId",
    si."paymentTermId",
    si."postingDate",
    si."dateIssued",
    si."dateDue",
    si."datePaid",
    si."locationId",
    si."currencyCode",
    COALESCE(sil."subtotal", 0) AS "subtotal",
    si."totalDiscount",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "totalAmount",
    COALESCE(sil."totalTax", 0) AS "totalTax",
    si."balance",
    si."exchangeRate",
    si."exchangeRateUpdatedAt",
    si."opportunityId",
    si."shipmentId",
    si."assignee",
    si."companyId",
    si."customFields",
    si."internalNotes",
    si."externalNotes",
    si."tags",
    si."createdAt",
    si."createdBy",
    si."updatedAt",
    si."updatedBy",
    sil."thumbnailPath",
    sil."itemType",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "invoiceTotal",
    sil."lines"
  FROM "salesInvoice" si
  LEFT JOIN (
    SELECT
      sil."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        COALESCE(sil."quantity", 0)*COALESCE(sil."unitPrice", 0)
        + COALESCE(sil."addOnCost", 0)
        + COALESCE(sil."nonTaxableAddOnCost", 0)
        + COALESCE(sil."shippingCost", 0)
      ) AS "subtotal",
      SUM(
        COALESCE(sil."taxPercent", 0) * (
          COALESCE(sil."quantity", 0)*COALESCE(sil."unitPrice", 0)
          + COALESCE(sil."addOnCost", 0)
          + COALESCE(sil."shippingCost", 0)
        )
      ) AS "totalTax",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        json_build_object(
          'id', sil.id,
          'invoiceLineType', sil."invoiceLineType",
          'quantity', sil."quantity",
          'unitPrice', sil."unitPrice",
          'itemId', sil."itemId"
        )
      ) AS "lines"
    FROM "salesInvoiceLine" sil
    LEFT JOIN "item" i
      ON i."id" = sil."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY sil."invoiceId"
  ) sil ON sil."invoiceId" = si."id"
  JOIN "salesInvoiceShipment" ss ON ss."id" = si."id";


-- -----------------------------------------------------------------------------
-- purchaseInvoices: compute subtotal / totalTax / totalAmount from the lines.
-- purchaseInvoiceLine."taxAmount" is the generated per-line tax (base currency).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
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
    pi."datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    -- Cast back to numeric(10,2): the stored purchaseInvoice columns are
    -- NUMERIC(10,2), so the existing view columns carry that typmod. CREATE OR
    -- REPLACE VIEW requires the replacement to keep the same typmod, and these
    -- SUM/arithmetic expressions are otherwise unconstrained numeric (typmod -1).
    COALESCE(pl."subtotal", 0)::numeric(10,2) AS "subtotal",
    pi."totalDiscount",
    (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END)::numeric(10,2) AS "totalAmount",
    COALESCE(pl."totalTax", 0)::numeric(10,2) AS "totalTax",
    pi."balance",
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
    COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
    CASE
      WHEN pi."dateDue" < CURRENT_DATE AND pi."datePaid" IS NULL THEN 'Overdue'
      ELSE pi."status"
    END AS status,
    pt."name" AS "paymentTermName"
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
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id";
