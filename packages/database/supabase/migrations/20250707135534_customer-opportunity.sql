-- Add customerId field to opportunity table
ALTER TABLE "opportunity" ADD COLUMN "customerId" TEXT;

-- Add supplierId field to supplierInteraction table  
ALTER TABLE "supplierInteraction" ADD COLUMN "supplierId" TEXT;

-- Update opportunity table with customerId from various sources in order of priority
UPDATE "opportunity" o
SET "customerId" = COALESCE(
  -- First try salesRfq
  (
    SELECT r."customerId" 
    FROM "salesRfq" r 
    WHERE r."opportunityId" = o."id"
    LIMIT 1
  ),
  -- Then try quote
  (
    SELECT q."customerId"
    FROM "quote" q
    WHERE q."opportunityId" = o."id"
    LIMIT 1
  ),
  -- Then try salesOrder
  (
    SELECT so."customerId"
    FROM "salesOrder" so
    WHERE so."opportunityId" = o."id"
    LIMIT 1
  ),
  -- Finally try salesInvoice
  (
    SELECT si."customerId"
    FROM "salesInvoice" si
    WHERE si."opportunityId" = o."id"
    LIMIT 1
  )
)
WHERE o."customerId" IS NULL;

-- Update supplierInteraction table with supplierId from various sources in order of priority
UPDATE "supplierInteraction" si
SET "supplierId" = COALESCE(
  -- First try purchaseOrder
  (
    SELECT po."supplierId"
    FROM "purchaseOrder" po
    WHERE po."supplierInteractionId" = si."id"
    LIMIT 1
  ),
  -- Then try supplierQuote
  (
    SELECT sq."supplierId"
    FROM "supplierQuote" sq
    WHERE sq."supplierInteractionId" = si."id"
    LIMIT 1
  ),
  -- Finally try purchaseInvoice
  (
    SELECT pi."supplierId"
    FROM "purchaseInvoice" pi
    WHERE pi."supplierInteractionId" = si."id"
    LIMIT 1
  )
)
WHERE si."supplierId" IS NULL;

-- Make customerId NOT NULL on opportunity table
ALTER TABLE "opportunity" ALTER COLUMN "customerId" SET NOT NULL;

-- Make supplierId NOT NULL on supplierInteraction table  
ALTER TABLE "supplierInteraction" ALTER COLUMN "supplierId" SET NOT NULL;

-- Add foreign key constraints
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_customerId_fkey" 
  FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplierInteraction" ADD CONSTRAINT "supplierInteraction_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add indexes for performance
CREATE INDEX "opportunity_customerId_idx" ON "opportunity" ("customerId");
CREATE INDEX "supplierInteraction_supplierId_idx" ON "supplierInteraction" ("supplierId");



-- Drop old policies
DO $$ 
BEGIN
  -- Drop opportunity policies
  DROP POLICY IF EXISTS "Employees with sales_view can view opportunities" ON "opportunity";
  DROP POLICY IF EXISTS "Employees with sales_create can insert opportunities" ON "opportunity";
  DROP POLICY IF EXISTS "Employees with sales_create can update opportunities" ON "opportunity";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete opportunities" ON "opportunity";

  -- Drop supplierInteraction policies  
  DROP POLICY IF EXISTS "Employees with purchasing_view can view supplierInteractions" ON "supplierInteraction";
  DROP POLICY IF EXISTS "Employees with purchasing_create can insert supplierInteractions" ON "supplierInteraction";
  DROP POLICY IF EXISTS "Employees with purchasing_update can update supplierInteractions" ON "supplierInteraction";
  DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplierInteractions" ON "supplierInteraction";

  -- Drop quote policies
  DROP POLICY IF EXISTS "Customers with sales_update can their own quotes" ON "quote";
  DROP POLICY IF EXISTS "Customers with sales_view can their own quotes" ON "quote";
  DROP POLICY IF EXISTS "Employees with sales_create can create quotes" ON "quote";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete quotes" ON "quote";
  DROP POLICY IF EXISTS "Employees with sales_update can update quotes" ON "quote";
  DROP POLICY IF EXISTS "Employees with sales_view can view quotes" ON "quote";
  DROP POLICY IF EXISTS "Requests with an API key can access quotes" ON "quote";

  -- Drop quoteLine policies
  DROP POLICY IF EXISTS "Customers with sales_create can create lines on their own quote" ON "quoteLine";
  DROP POLICY IF EXISTS "Customers with sales_delete can delete lines on their own quote" ON "quoteLine";
  DROP POLICY IF EXISTS "Customers with sales_update can their own quote lines" ON "quoteLine";
  DROP POLICY IF EXISTS "Customers with sales_view can their own quote lines" ON "quoteLine";
  DROP POLICY IF EXISTS "Employees with sales_create can create quote lines" ON "quoteLine";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete quote lines" ON "quoteLine";
  DROP POLICY IF EXISTS "Employees with sales_update can update quote lines" ON "quoteLine";
  DROP POLICY IF EXISTS "Employees with sales_view can view quote lines" ON "quoteLine";
  DROP POLICY IF EXISTS "Requests with an API key can access quote lines" ON "quoteLine";

  -- Drop quoteShipment policies
  DROP POLICY IF EXISTS "Employees with sales_view can view quote shipments" ON "quoteShipment";
  DROP POLICY IF EXISTS "Employees with sales_create can create quote shipments" ON "quoteShipment";
  DROP POLICY IF EXISTS "Employees with sales_update can update quote shipments" ON "quoteShipment";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete quote shipments" ON "quoteShipment";
  DROP POLICY IF EXISTS "Requests with an API key can access quote shipments" ON "quoteShipment";

  -- Drop quotePayment policies
  DROP POLICY IF EXISTS "Employees with sales_view can view quote payments" ON "quotePayment";
  DROP POLICY IF EXISTS "Employees with sales_create can create quote payments" ON "quotePayment";
  DROP POLICY IF EXISTS "Employees with sales_update can update quote payments" ON "quotePayment";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete quote payments" ON "quotePayment";
  DROP POLICY IF EXISTS "Requests with an API key can access quote payments" ON "quotePayment";

  -- DROP salesOrder

  DROP POLICY IF EXISTS "Customers with sales_update can update their own sales orders" ON "salesOrder";
  DROP POLICY IF EXISTS "Customers with sales_view can their own sales orders" ON "salesOrder";
  DROP POLICY IF EXISTS "Employees with sales_create can create sales orders" ON "salesOrder";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete sales orders" ON "salesOrder";
  DROP POLICY IF EXISTS "Employees with sales_update can update sales orders" ON "salesOrder";
  DROP POLICY IF EXISTS "Employees with sales_view, inventory_view, or invoicing_view ca" ON "salesOrder";
  DROP POLICY IF EXISTS "Requests with an API key can access requests for sales order" ON "salesOrder";

  -- DROP salesOrderLine
  DROP POLICY IF EXISTS "Customers with sales_create can create lines on their own sales" ON "salesOrderLine";
  DROP POLICY IF EXISTS "Customers with sales_delete can delete lines on their own sales" ON "salesOrderLine";
  DROP POLICY IF EXISTS "Customers with sales_update can update their own sales order li" ON "salesOrderLine";
  DROP POLICY IF EXISTS "Customers with sales_view can their own sales order lines" ON "salesOrderLine";
  DROP POLICY IF EXISTS "Employees with sales_create can create sales order lines" ON "salesOrderLine";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete sales order lines" ON "salesOrderLine";
  DROP POLICY IF EXISTS "Employees with sales_update can update sales order lines" ON "salesOrderLine";
  DROP POLICY IF EXISTS "Employees with sales_view can view sales order lines" ON "salesOrderLine";
  DROP POLICY IF EXISTS "Requests with an API key can access requests for sales order li" ON "salesOrderLine";

  -- Drop salesOrderShipment policies
  DROP POLICY IF EXISTS "Employees with sales_view can view sales order shipments" ON "salesOrderShipment";
  DROP POLICY IF EXISTS "Employees with sales_create can create sales order shipments" ON "salesOrderShipment";
  DROP POLICY IF EXISTS "Employees with sales_update can update sales order shipments" ON "salesOrderShipment";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete sales order shipments" ON "salesOrderShipment";
  DROP POLICY IF EXISTS "Requests with an API key can access sales order shipments" ON "salesOrderShipment";

  -- Drop salesOrderPayment policies
  DROP POLICY IF EXISTS "Employees with sales_view can view sales order payments" ON "salesOrderPayment";
  DROP POLICY IF EXISTS "Employees with sales_create can create sales order payments" ON "salesOrderPayment";
  DROP POLICY IF EXISTS "Employees with sales_update can update sales order payments" ON "salesOrderPayment";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete sales order payments" ON "salesOrderPayment";
  DROP POLICY IF EXISTS "Requests with an API key can access sales order payments" ON "salesOrderPayment";

  -- Drop salesRFQ policies
  DROP POLICY IF EXISTS "Customer with sales_view can view their own sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Employees with sales_create can create sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Employees with sales_update can edit sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Employees with sales_view can view sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Requests with an API key can access sales RFQs" ON "salesRfq";

  -- Drop salesRfqLine policies
  DROP POLICY IF EXISTS "Customers with sales_view can their own purchase order lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_create can create sales rfq lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_create can insert salesRfqLine" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete sales rfq lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete salesRfqLine" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_update can edit sales rfq lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_update can update salesRfqLine" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_view can view sales rfq lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_view can view salesRfqLine" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Requests with an API key can access sales RFQ lines" ON "salesRfqLine";

  -- Drop job policies
  DROP POLICY IF EXISTS "Employees can view jobs" ON "job";
  DROP POLICY IF EXISTS "Employees with production_create can insert jobs" ON "job";
  DROP POLICY IF EXISTS "Employees with production_update can update jobs" ON "job";
  DROP POLICY IF EXISTS "Employees with production_delete can delete jobs" ON "job";
  DROP POLICY IF EXISTS "Customers with production_view can view their own jobs" ON "job";
  DROP POLICY IF EXISTS "Requests with an API key can access jobs" ON "job";

  -- Drop jobOperation policies
  DROP POLICY IF EXISTS "Employees can view job operations" ON "jobOperation";
  DROP POLICY IF EXISTS "Employees with production_create can insert job operations" ON "jobOperation";
  DROP POLICY IF EXISTS "Employees with production_update can update job operations" ON "jobOperation";
  DROP POLICY IF EXISTS "Employees with production_delete can delete job operations" ON "jobOperation";
  DROP POLICY IF EXISTS "Requests with an API key can access jobs" ON "jobOperation";

  -- Drop jobMaterial policies
  DROP POLICY IF EXISTS "Employees can view job materials" ON "jobMaterial";
  DROP POLICY IF EXISTS "Employees with production_create can insert job materials" ON "jobMaterial";
  DROP POLICY IF EXISTS "Employees with production_update can update job materials" ON "jobMaterial";
  DROP POLICY IF EXISTS "Employees with production_delete can delete job materials" ON "jobMaterial";
  DROP POLICY IF EXISTS "Requests with an API key can access jobs" ON "jobMaterial";

  -- Drop standardized policies
  DROP POLICY IF EXISTS "SELECT" ON "public"."opportunity";
  DROP POLICY IF EXISTS "INSERT" ON "public"."opportunity";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."opportunity";
  DROP POLICY IF EXISTS "DELETE" ON "public"."opportunity";

  DROP POLICY IF EXISTS "SELECT" ON "public"."supplierInteraction";
  DROP POLICY IF EXISTS "INSERT" ON "public"."supplierInteraction";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."supplierInteraction";
  DROP POLICY IF EXISTS "DELETE" ON "public"."supplierInteraction";

  DROP POLICY IF EXISTS "SELECT" ON "public"."quoteShipment";
  DROP POLICY IF EXISTS "INSERT" ON "public"."quoteShipment";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."quoteShipment";
  DROP POLICY IF EXISTS "DELETE" ON "public"."quoteShipment";

  DROP POLICY IF EXISTS "SELECT" ON "public"."quotePayment";
  DROP POLICY IF EXISTS "INSERT" ON "public"."quotePayment";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."quotePayment";
  DROP POLICY IF EXISTS "DELETE" ON "public"."quotePayment";

  DROP POLICY IF EXISTS "SELECT" ON "public"."salesOrderShipment";
  DROP POLICY IF EXISTS "INSERT" ON "public"."salesOrderShipment";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."salesOrderShipment";
  DROP POLICY IF EXISTS "DELETE" ON "public"."salesOrderShipment";

  DROP POLICY IF EXISTS "SELECT" ON "public"."salesOrderPayment";
  DROP POLICY IF EXISTS "INSERT" ON "public"."salesOrderPayment";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."salesOrderPayment";
  DROP POLICY IF EXISTS "DELETE" ON "public"."salesOrderPayment";

  DROP POLICY IF EXISTS "SELECT" ON "public"."job";
  DROP POLICY IF EXISTS "INSERT" ON "public"."job";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."job";
  DROP POLICY IF EXISTS "DELETE" ON "public"."job";

  DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperation";
  DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperation";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperation";
  DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperation";

  DROP POLICY IF EXISTS "SELECT" ON "public"."jobMaterial";
  DROP POLICY IF EXISTS "INSERT" ON "public"."jobMaterial";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."jobMaterial";
  DROP POLICY IF EXISTS "DELETE" ON "public"."jobMaterial";
END $$;

-- Create new standardized policies
CREATE POLICY "SELECT" ON "public"."opportunity"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."opportunity"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."opportunity"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."opportunity"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
);

CREATE POLICY "SELECT" ON "public"."supplierInteraction"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[]) OR
  "supplierId" = ANY ((SELECT get_supplier_ids_with_supplier_permission('purchasing_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."supplierInteraction"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[]) OR
  "supplierId" = ANY ((SELECT get_supplier_ids_with_supplier_permission('purchasing_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."supplierInteraction"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[]) OR
  "supplierId" = ANY ((SELECT get_supplier_ids_with_supplier_permission('purchasing_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."supplierInteraction"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]) OR
  "supplierId" = ANY ((SELECT get_supplier_ids_with_supplier_permission('purchasing_delete'))::text[])
);


CREATE POLICY "SELECT" ON "public"."quote"
FOR SELECT TO public USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('production_view'))
    ))
  ) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."quote"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."quote"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."quote"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
);

CREATE POLICY "SELECT" ON "public"."quoteLine"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" so 
    WHERE so."id" = "quoteLine"."quoteId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."quoteLine"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" so 
    WHERE so."id" = "quoteLine"."quoteId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteLine"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" so 
    WHERE so."id" = "quoteLine"."quoteId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."quoteLine"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" so 
    WHERE so."id" = "quoteLine"."quoteId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
  )
);

CREATE POLICY "SELECT" ON "public"."quoteShipment"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" q 
    WHERE q."id" = "quoteShipment"."id"
    AND q."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."quoteShipment"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" q 
    WHERE q."id" = "quoteShipment"."id"
    AND q."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteShipment"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" q 
    WHERE q."id" = "quoteShipment"."id"
    AND q."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."quoteShipment"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" q 
    WHERE q."id" = "quoteShipment"."id"
    AND q."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
  )
);

CREATE POLICY "SELECT" ON "public"."quotePayment"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" q 
    WHERE q."id" = "quotePayment"."id"
    AND q."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."quotePayment"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" q 
    WHERE q."id" = "quotePayment"."id"
    AND q."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."quotePayment"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" q 
    WHERE q."id" = "quotePayment"."id"
    AND q."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."quotePayment"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "quote" q 
    WHERE q."id" = "quotePayment"."id"
    AND q."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
  )
);

CREATE POLICY "SELECT" ON "public"."salesOrder"
FOR SELECT TO public USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('production_view'))
    ))
  ) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."salesOrder"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."salesOrder"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."salesOrder"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
);

CREATE POLICY "SELECT" ON "public"."salesOrderLine"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderLine"."salesOrderId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."salesOrderLine"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderLine"."salesOrderId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."salesOrderLine"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderLine"."salesOrderId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."salesOrderLine"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderLine"."salesOrderId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
  )
);

CREATE POLICY "SELECT" ON "public"."salesOrderShipment"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderShipment"."id"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."salesOrderShipment"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderShipment"."id"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."salesOrderShipment"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderShipment"."id"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."salesOrderShipment"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderShipment"."id"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
  )
);

CREATE POLICY "SELECT" ON "public"."salesOrderPayment"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderPayment"."id"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."salesOrderPayment"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderPayment"."id"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."salesOrderPayment"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderPayment"."id"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."salesOrderPayment"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesOrder" so 
    WHERE so."id" = "salesOrderPayment"."id"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
  )
);

CREATE POLICY "SELECT" ON "public"."salesRfq"
FOR SELECT TO public USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('production_view'))
    ))
  ) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."salesRfq"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."salesRfq"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."salesRfq"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
);

CREATE POLICY "SELECT" ON "public"."salesRfqLine"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesRfq" so 
    WHERE so."id" = "salesRfqLine"."salesRfqId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."salesRfqLine"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesRfq" so 
    WHERE so."id" = "salesRfqLine"."salesRfqId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."salesRfqLine"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesRfq" so 
    WHERE so."id" = "salesRfqLine"."salesRfqId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."salesRfqLine"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesRfq" so 
    WHERE so."id" = "salesRfqLine"."salesRfqId"
    AND so."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
  )
);


CREATE POLICY "SELECT" ON "public"."job"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('production_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."job"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('production_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."job"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('production_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."job"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]) OR
  "customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('production_delete'))::text[])
);

CREATE POLICY "SELECT" ON "public"."jobOperation"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "job" j 
    WHERE j."id" = "jobOperation"."jobId"
    AND j."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('production_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperation"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "job" j 
    WHERE j."id" = "jobOperation"."jobId"
    AND j."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('production_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperation"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "job" j 
    WHERE j."id" = "jobOperation"."jobId"
    AND j."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('production_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperation"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "job" j 
    WHERE j."id" = "jobOperation"."jobId"
    AND j."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('production_delete'))::text[])
  )
);

CREATE POLICY "SELECT" ON "public"."jobMaterial"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."jobMaterial"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."jobMaterial"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."jobMaterial"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

DROP FUNCTION IF EXISTS get_opportunity_with_related_records(TEXT);
CREATE FUNCTION get_opportunity_with_related_records(opportunity_id TEXT)
RETURNS TABLE (
  "id" TEXT,
  "companyId" TEXT,
  "customerId" TEXT,
  "purchaseOrderDocumentPath" TEXT,
  "requestForQuoteDocumentPath" TEXT,
  "salesRfqs" JSONB,
  "quotes" JSONB,
  "salesOrders" JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o."id",
    o."companyId",
    o."customerId",
    o."purchaseOrderDocumentPath",
    o."requestForQuoteDocumentPath",
    (
      SELECT COALESCE(jsonb_agg(rfq.* ORDER BY rfq."revisionId" DESC), '[]'::jsonb)
      FROM "salesRfq" rfq
      WHERE rfq."opportunityId" = o.id
    ) AS "salesRfqs",
    (
      SELECT COALESCE(jsonb_agg(q.* ORDER BY q."revisionId" DESC), '[]'::jsonb)
      FROM "quote" q
      WHERE q."opportunityId" = o.id
    ) AS "quotes",
    (
      SELECT COALESCE(jsonb_agg(so.* ORDER BY so."revisionId" DESC), '[]'::jsonb)
      FROM "salesOrder" so
      WHERE so."opportunityId" = o.id
    ) AS "salesOrders"
  FROM "opportunity" o
  WHERE o.id = opportunity_id::text;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

DROP FUNCTION IF EXISTS get_supplier_interaction_with_related_records(TEXT);
CREATE FUNCTION get_supplier_interaction_with_related_records(supplier_interaction_id TEXT)
RETURNS TABLE (
  "id" TEXT,
  "companyId" TEXT,
  "supplierId" TEXT,
  "supplierQuotes" JSONB,
  "purchaseOrders" JSONB,
  "purchaseInvoices" JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    si."id",
    si."companyId",
    si."supplierId",
    (
      SELECT COALESCE(jsonb_agg(sq.* ORDER BY sq."supplierQuoteId" DESC), '[]'::jsonb)
      FROM "supplierQuote" sq
      WHERE sq."supplierInteractionId" = si.id
    ) AS "supplierQuotes",
    (
      SELECT COALESCE(jsonb_agg(po.* ORDER BY po."purchaseOrderId" DESC), '[]'::jsonb)
      FROM "purchaseOrder" po
      WHERE po."supplierInteractionId" = si.id
    ) AS "purchaseOrders",
    (
      SELECT COALESCE(jsonb_agg(pi.* ORDER BY pi."invoiceId" DESC), '[]'::jsonb)
      FROM "purchaseInvoice" pi
      WHERE pi."supplierInteractionId" = si.id
    ) AS "purchaseInvoices"
  FROM "supplierInteraction" si
  WHERE si.id = supplier_interaction_id::text;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;