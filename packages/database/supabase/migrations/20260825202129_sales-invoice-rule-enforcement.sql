-- Widen the two CHECK constraints that pin the sales family to its surfaces
-- and the acknowledgment evidence to its document types, now that the
-- 'salesInvoiceLine' enum value exists (added by the previous migration —
-- it cannot be referenced in the same transaction that adds it).

ALTER TABLE "enforcementRule"
  DROP CONSTRAINT IF EXISTS "enforcementRule_sales_surfaces";

ALTER TABLE "enforcementRule"
  ADD CONSTRAINT "enforcementRule_sales_surfaces" CHECK (
    "family" <> 'sales' OR "surfaces" <@ ARRAY[
      'quoteLine', 'salesOrderLine', 'salesInvoiceLine'
    ]::"enforcementRuleSurface"[]
  );

-- The inline column CHECK gets an auto-generated name; re-add it named so the
-- next widening doesn't have to guess.
ALTER TABLE "enforcementRuleAcknowledgment"
  DROP CONSTRAINT IF EXISTS "enforcementRuleAcknowledgment_documentType_check";

ALTER TABLE "enforcementRuleAcknowledgment"
  ADD CONSTRAINT "enforcementRuleAcknowledgment_documentType_check" CHECK (
    "documentType" IN ('quote', 'salesOrder', 'salesInvoice')
  );
