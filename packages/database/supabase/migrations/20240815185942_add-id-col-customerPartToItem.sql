-- 1. Add the new `id` column with a default value 
ALTER TABLE public."customerPartToItem"
ADD COLUMN "id" text DEFAULT xid();

-- 2. Drop the existing primary key constraint
ALTER TABLE public."customerPartToItem"
DROP CONSTRAINT "customerPartToItem_pkey";

-- 3. Set the new `id` column as the primary key
ALTER TABLE public."customerPartToItem"
ADD CONSTRAINT "customerPartToItem_pkey" PRIMARY KEY ("id");

-- 4. Add back in the unique constraint on (customerId, itemId)
ALTER TABLE public."customerPartToItem"
ADD CONSTRAINT "customerPartToItem_customerId_itemId_key" UNIQUE ("customerId", "itemId");

-- 5. Fix the policy that was created incorrectly the first time
DROP POLICY IF EXISTS "Employees with sales_create can insert customer part to item" ON public."customerPartToItem";
CREATE POLICY "Employees with sales_create can insert customer part to item" ON "customerPartToItem" FOR INSERT WITH CHECK (
  has_company_permission('sales_create', "companyId") AND
  has_role('employee', "companyId")
);

DROP POLICY  "Employees with sales_delete can delete customer part to item" ON "customerPartToItem";
CREATE POLICY "Employees with sales_delete can delete customer part to item" ON "customerPartToItem" FOR DELETE USING (
  has_company_permission('sales_delete', "companyId")  AND 
  has_role('employee', "companyId")
);

CREATE POLICY "Employees with sales_update can update customer part to item" ON "customerPartToItem" FOR UPDATE USING (
  has_company_permission('sales_update', "companyId") AND
  has_role('employee', "companyId")
);