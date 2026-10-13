-- Third sales-family surface: sales invoice lines. An invoice can be raised
-- with no upstream quote or order, so without this surface a restricted item
-- invoiced directly reaches revenue having passed no gate.
--
-- ALTER TYPE ... ADD VALUE cannot be used by other statements in the same
-- transaction, so the CHECK-constraint widening lives in the follow-up
-- migration (sales-invoice-rule-enforcement).
ALTER TYPE "enforcementRuleSurface" ADD VALUE IF NOT EXISTS 'salesInvoiceLine';
