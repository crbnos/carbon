-- Drop old policies
DO $$ 
BEGIN
  -- Drop salesRfq policies
  DROP POLICY IF EXISTS "Employees with sales_view can view sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Employees with sales_create can create sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Employees with sales_update can edit sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete sales rfqs" ON "salesRfq";
  DROP POLICY IF EXISTS "Customer with sales_view can view their own sales rfqs" ON "salesRfq";

  -- Drop salesRfqLine policies
  DROP POLICY IF EXISTS "Employees with sales_view can view sales rfq lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_create can create sales rfq lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_update can edit sales rfq lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Employees with sales_delete can delete sales rfq lines" ON "salesRfqLine";
  DROP POLICY IF EXISTS "Customers with sales_view can their own purchase order lines" ON "salesRfqLine";

  -- Drop standardized policies if they exist
  DROP POLICY IF EXISTS "SELECT" ON "public"."salesRfq";
  DROP POLICY IF EXISTS "INSERT" ON "public"."salesRfq";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."salesRfq";
  DROP POLICY IF EXISTS "DELETE" ON "public"."salesRfq";

  DROP POLICY IF EXISTS "SELECT" ON "public"."salesRfqLine";
  DROP POLICY IF EXISTS "INSERT" ON "public"."salesRfqLine";
  DROP POLICY IF EXISTS "UPDATE" ON "public"."salesRfqLine";
  DROP POLICY IF EXISTS "DELETE" ON "public"."salesRfqLine";
END $$;

-- Create new standardized policies for salesRfq
CREATE POLICY "SELECT" ON "public"."salesRfq"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
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

-- Create new standardized policies for salesRfqLine
CREATE POLICY "SELECT" ON "public"."salesRfqLine"
FOR SELECT TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesRfq" rfq 
    WHERE rfq."id" = "salesRfqLine"."salesRfqId"
    AND rfq."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_view'))::text[])
  )
);

CREATE POLICY "INSERT" ON "public"."salesRfqLine"
FOR INSERT TO public WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesRfq" rfq 
    WHERE rfq."id" = "salesRfqLine"."salesRfqId"
    AND rfq."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_create'))::text[])
  )
);

CREATE POLICY "UPDATE" ON "public"."salesRfqLine"
FOR UPDATE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesRfq" rfq 
    WHERE rfq."id" = "salesRfqLine"."salesRfqId"
    AND rfq."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_update'))::text[])
  )
);

CREATE POLICY "DELETE" ON "public"."salesRfqLine"
FOR DELETE TO public USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[]) OR
  EXISTS (
    SELECT 1 FROM "salesRfq" rfq 
    WHERE rfq."id" = "salesRfqLine"."salesRfqId"
    AND rfq."customerId" = ANY ((SELECT get_customer_ids_with_customer_permission('sales_delete'))::text[])
  )
);
