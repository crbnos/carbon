-- The first migration's trigger covers quote, order, invoice, and memo.
-- Extend it to all sales document headers that have a customer, and give
-- customer memos their originating document's snapshot when one is present.
CREATE OR REPLACE FUNCTION public.copy_customer_sales_dimensions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  source_type TEXT;
  source_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'memo' THEN
    IF NEW."salesReturnOrderId" IS NOT NULL THEN
      source_type := 'salesReturnOrder';
      source_id := NEW."salesReturnOrderId";
    ELSIF NEW."rentalAgreementId" IS NOT NULL THEN
      source_type := 'rentalAgreement';
      source_id := NEW."rentalAgreementId";
    ELSIF NEW."customerContractId" IS NOT NULL THEN
      source_type := 'customerContract';
      source_id := NEW."customerContractId";
    END IF;

    IF source_id IS NOT NULL THEN
      INSERT INTO public."salesDimensionAssignment" (
        "companyId", "memoId", "dimensionId", "valueId", "createdBy"
      )
      SELECT NEW."companyId", NEW."id", assignment."dimensionId",
        assignment."valueId", NEW."createdBy"
      FROM public."salesDimensionAssignment" AS assignment
      WHERE assignment."companyId" = NEW."companyId"
        AND CASE source_type
          WHEN 'salesReturnOrder' THEN assignment."salesReturnOrderId"
          WHEN 'rentalAgreement' THEN assignment."rentalAgreementId"
          WHEN 'customerContract' THEN assignment."customerContractId"
        END = source_id;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW."customerId" IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public."salesDimensionAssignment" (
    "companyId", "quoteId", "salesOrderId", "salesInvoiceId", "memoId",
    "salesReturnOrderId", "customerContractId", "rentalAgreementId", "serviceJobId",
    "dimensionId", "valueId", "createdBy"
  )
  SELECT NEW."companyId",
    CASE WHEN TG_TABLE_NAME = 'quote' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'salesOrder' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'salesInvoice' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'memo' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'salesReturnOrder' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'customerContract' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'rentalAgreement' THEN NEW."id" END,
    CASE WHEN TG_TABLE_NAME = 'serviceJob' THEN NEW."id" END,
    assignment."dimensionId", assignment."valueId", NEW."createdBy"
  FROM public."salesDimensionAssignment" AS assignment
  WHERE assignment."companyId" = NEW."companyId"
    AND assignment."customerId" = NEW."customerId";

  RETURN NEW;
END;
$$;

CREATE TRIGGER "salesReturnOrder_copyCustomerSalesDimensions"
  AFTER INSERT ON "salesReturnOrder" FOR EACH ROW EXECUTE FUNCTION public.copy_customer_sales_dimensions();
CREATE TRIGGER "customerContract_copyCustomerSalesDimensions"
  AFTER INSERT ON "customerContract" FOR EACH ROW EXECUTE FUNCTION public.copy_customer_sales_dimensions();
CREATE TRIGGER "rentalAgreement_copyCustomerSalesDimensions"
  AFTER INSERT ON "rentalAgreement" FOR EACH ROW EXECUTE FUNCTION public.copy_customer_sales_dimensions();
CREATE TRIGGER "serviceJob_copyCustomerSalesDimensions"
  AFTER INSERT ON "serviceJob" FOR EACH ROW EXECUTE FUNCTION public.copy_customer_sales_dimensions();
