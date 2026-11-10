CREATE TABLE "salesDimensionAssignment" (
  "id" TEXT NOT NULL DEFAULT id('sda'),
  "companyId" TEXT NOT NULL,
  "customerId" TEXT,
  "quoteId" TEXT,
  "salesOrderId" TEXT,
  "salesInvoiceId" TEXT,
  "memoId" TEXT,
  "salesReturnOrderId" TEXT,
  "customerContractId" TEXT,
  "rentalAgreementId" TEXT,
  "serviceJobId" TEXT,
  "dimensionId" TEXT NOT NULL,
  "valueId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "salesDimensionAssignment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "salesDimensionAssignment_oneSource_check" CHECK (
    num_nonnulls("customerId", "quoteId", "salesOrderId", "salesInvoiceId", "memoId",
      "salesReturnOrderId", "customerContractId", "rentalAgreementId", "serviceJobId") = 1
  ),
  CONSTRAINT "salesDimensionAssignment_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_customerId_fkey"
    FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_salesInvoiceId_fkey"
    FOREIGN KEY ("salesInvoiceId") REFERENCES "salesInvoice"("id") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_memoId_fkey"
    FOREIGN KEY ("memoId") REFERENCES "memo"("id") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_salesReturnOrderId_fkey"
    FOREIGN KEY ("salesReturnOrderId", "companyId") REFERENCES "salesReturnOrder"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_customerContractId_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_rentalAgreementId_fkey"
    FOREIGN KEY ("rentalAgreementId", "companyId") REFERENCES "rentalAgreement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_serviceJobId_fkey"
    FOREIGN KEY ("serviceJobId", "companyId") REFERENCES "serviceJob"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "salesDimensionAssignment_dimensionId_fkey"
    FOREIGN KEY ("dimensionId") REFERENCES "dimension"("id") ON DELETE RESTRICT,
  CONSTRAINT "salesDimensionAssignment_valueId_fkey"
    FOREIGN KEY ("valueId") REFERENCES "dimensionValue"("id") ON DELETE RESTRICT
);

CREATE INDEX "salesDimensionAssignment_companyId_idx" ON "salesDimensionAssignment" ("companyId");
CREATE INDEX "salesDimensionAssignment_dimensionId_idx" ON "salesDimensionAssignment" ("dimensionId");
CREATE INDEX "salesDimensionAssignment_valueId_idx" ON "salesDimensionAssignment" ("valueId");
CREATE INDEX "salesDimensionAssignment_createdBy_idx" ON "salesDimensionAssignment" ("createdBy");
CREATE INDEX "salesDimensionAssignment_updatedBy_idx" ON "salesDimensionAssignment" ("updatedBy");
CREATE UNIQUE INDEX "salesDimensionAssignment_customer_dimension_key"
  ON "salesDimensionAssignment" ("customerId", "companyId", "dimensionId") WHERE "customerId" IS NOT NULL;
CREATE UNIQUE INDEX "salesDimensionAssignment_quote_dimension_key"
  ON "salesDimensionAssignment" ("quoteId", "companyId", "dimensionId") WHERE "quoteId" IS NOT NULL;
CREATE UNIQUE INDEX "salesDimensionAssignment_salesOrder_dimension_key"
  ON "salesDimensionAssignment" ("salesOrderId", "companyId", "dimensionId") WHERE "salesOrderId" IS NOT NULL;
CREATE UNIQUE INDEX "salesDimensionAssignment_salesInvoice_dimension_key"
  ON "salesDimensionAssignment" ("salesInvoiceId", "companyId", "dimensionId") WHERE "salesInvoiceId" IS NOT NULL;
CREATE UNIQUE INDEX "salesDimensionAssignment_memo_dimension_key"
  ON "salesDimensionAssignment" ("memoId", "companyId", "dimensionId") WHERE "memoId" IS NOT NULL;
CREATE UNIQUE INDEX "salesDimensionAssignment_salesReturnOrder_dimension_key"
  ON "salesDimensionAssignment" ("salesReturnOrderId", "companyId", "dimensionId") WHERE "salesReturnOrderId" IS NOT NULL;
CREATE UNIQUE INDEX "salesDimensionAssignment_customerContract_dimension_key"
  ON "salesDimensionAssignment" ("customerContractId", "companyId", "dimensionId") WHERE "customerContractId" IS NOT NULL;
CREATE UNIQUE INDEX "salesDimensionAssignment_rentalAgreement_dimension_key"
  ON "salesDimensionAssignment" ("rentalAgreementId", "companyId", "dimensionId") WHERE "rentalAgreementId" IS NOT NULL;
CREATE UNIQUE INDEX "salesDimensionAssignment_serviceJob_dimension_key"
  ON "salesDimensionAssignment" ("serviceJobId", "companyId", "dimensionId") WHERE "serviceJobId" IS NOT NULL;

-- A new document takes a snapshot of the customer's current dimensions.
-- Conversion services replace this with the source document's snapshot in
-- their existing transaction; later customer edits do not rewrite documents.
CREATE FUNCTION public.copy_customer_sales_dimensions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW."customerId" IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public."salesDimensionAssignment" (
    "companyId", "quoteId", "salesOrderId", "salesInvoiceId", "memoId",
    "dimensionId", "valueId", "createdBy"
  )
  SELECT NEW."companyId",
    CASE WHEN TG_TABLE_NAME = 'quote' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'salesOrder' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'salesInvoice' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'memo' THEN NEW."id" END,
    assignment."dimensionId", assignment."valueId", NEW."createdBy"
  FROM public."salesDimensionAssignment" AS assignment
  WHERE assignment."companyId" = NEW."companyId"
    AND assignment."customerId" = NEW."customerId";

  RETURN NEW;
END;
$$;

CREATE TRIGGER "quote_copyCustomerSalesDimensions"
  AFTER INSERT ON "quote" FOR EACH ROW EXECUTE FUNCTION public.copy_customer_sales_dimensions();
CREATE TRIGGER "salesOrder_copyCustomerSalesDimensions"
  AFTER INSERT ON "salesOrder" FOR EACH ROW EXECUTE FUNCTION public.copy_customer_sales_dimensions();
CREATE TRIGGER "salesInvoice_copyCustomerSalesDimensions"
  AFTER INSERT ON "salesInvoice" FOR EACH ROW EXECUTE FUNCTION public.copy_customer_sales_dimensions();
CREATE TRIGGER "memo_copyCustomerSalesDimensions"
  AFTER INSERT ON "memo" FOR EACH ROW EXECUTE FUNCTION public.copy_customer_sales_dimensions();

-- journalLineDimension.valueId is polymorphic and intentionally has no FK.
-- Retain Custom value labels while posted journal lines refer to them.
CREATE FUNCTION prevent_used_sales_dimension_value_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "journalLineDimension"
    WHERE "dimensionId" = OLD."dimensionId" AND "valueId" = OLD."id"
  ) OR EXISTS (
    SELECT 1 FROM "salesDimensionAssignment" WHERE "valueId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'Cannot delete a dimension value used by sales assignments or journal lines'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "dimensionValue_preventUsedSalesDimensionValueDelete"
  BEFORE DELETE ON "dimensionValue"
  FOR EACH ROW EXECUTE FUNCTION prevent_used_sales_dimension_value_delete();
