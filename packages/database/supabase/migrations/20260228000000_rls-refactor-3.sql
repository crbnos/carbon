-- ============================================================================
-- RLS Refactor 3: Continue standardizing RLS policies
-- Continues work from 20250201181148_rls-refactor.sql and 20250208221244_rls-refactor-2.sql
-- ============================================================================



-- location

DROP POLICY IF EXISTS "Employees can view locations for their companies" ON "public"."location";
DROP POLICY IF EXISTS "Employees with resources_create can insert locations" ON "public"."location";
DROP POLICY IF EXISTS "Employees with resources_update can update locations" ON "public"."location";
DROP POLICY IF EXISTS "Employees with resources_delete can delete locations" ON "public"."location";
DROP POLICY IF EXISTS "Requests with an API key can access locations" ON "public"."location";

CREATE POLICY "SELECT" ON "public"."location"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."location"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."location"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."location"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_delete'))::text[]
  )
);

-- partner

DROP POLICY IF EXISTS "Employees with resources_view can view partners" ON "public"."partner";
DROP POLICY IF EXISTS "Employees with resources_create can insert partners" ON "public"."partner";
DROP POLICY IF EXISTS "Employees with resources_update can update partners" ON "public"."partner";
DROP POLICY IF EXISTS "Employees with resources_delete can delete partners" ON "public"."partner";
DROP POLICY IF EXISTS "Requests with an API key can access partners" ON "public"."partner";

CREATE POLICY "SELECT" ON "public"."partner"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."partner"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."partner"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."partner"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_delete'))::text[]
  )
);

-- process

DROP POLICY IF EXISTS "Employees can view processes" ON "public"."process";
DROP POLICY IF EXISTS "Employees with resources_create can insert processes" ON "public"."process";
DROP POLICY IF EXISTS "Employees with resources_update can update processes" ON "public"."process";
DROP POLICY IF EXISTS "Employees with resources_delete can delete processes" ON "public"."process";
DROP POLICY IF EXISTS "Requests with an API key can access processes" ON "public"."process";

CREATE POLICY "SELECT" ON "public"."process"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."process"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."process"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."process"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_delete'))::text[]
  )
);

-- shift

DROP POLICY IF EXISTS "Employees can view shifts" ON "public"."shift";
DROP POLICY IF EXISTS "Employees with people_create can insert shifts" ON "public"."shift";
DROP POLICY IF EXISTS "Employees with people_update can update shifts" ON "public"."shift";
DROP POLICY IF EXISTS "Employees with people_delete can delete shifts" ON "public"."shift";
DROP POLICY IF EXISTS "Requests with an API key can access shifts" ON "public"."shift";

CREATE POLICY "SELECT" ON "public"."shift"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."shift"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."shift"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."shift"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_delete'))::text[]
  )
);

-- workCenter

DROP POLICY IF EXISTS "Employees can view work centers" ON "public"."workCenter";
DROP POLICY IF EXISTS "Employees with resources_create can insert work centers" ON "public"."workCenter";
DROP POLICY IF EXISTS "Employees with resources_update can update work centers" ON "public"."workCenter";
DROP POLICY IF EXISTS "Employees with resources_delete can delete work centers" ON "public"."workCenter";
DROP POLICY IF EXISTS "Requests with an API key can access work centers" ON "public"."workCenter";

CREATE POLICY "SELECT" ON "public"."workCenter"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."workCenter"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."workCenter"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."workCenter"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_delete'))::text[]
  )
);

-- workCenterProcess

DROP POLICY IF EXISTS "Employees can view work center/processes" ON "public"."workCenterProcess";
DROP POLICY IF EXISTS "Employees with resources_create can insert work center/processes" ON "public"."workCenterProcess";
DROP POLICY IF EXISTS "Employees with resources_update can update work center/processes" ON "public"."workCenterProcess";
DROP POLICY IF EXISTS "Employees with resources_delete can delete work center/processes" ON "public"."workCenterProcess";
DROP POLICY IF EXISTS "Requests with an API key can access work center processes" ON "public"."workCenterProcess";

CREATE POLICY "SELECT" ON "public"."workCenterProcess"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."workCenterProcess"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."workCenterProcess"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."workCenterProcess"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_delete'))::text[]
  )
);

-- ============================================================================
-- Batch 2: Parts & Inventory
-- ============================================================================

-- itemPostingGroup

DROP POLICY IF EXISTS "Employees with parts_view can view item groups" ON "public"."itemPostingGroup";
DROP POLICY IF EXISTS "Employees with parts_create can insert item groups" ON "public"."itemPostingGroup";
DROP POLICY IF EXISTS "Employees with parts_update can update item groups" ON "public"."itemPostingGroup";
DROP POLICY IF EXISTS "Employees with parts_delete can delete item groups" ON "public"."itemPostingGroup";
DROP POLICY IF EXISTS "Requests with an API key can access item posting groups" ON "public"."itemPostingGroup";

CREATE POLICY "SELECT" ON "public"."itemPostingGroup"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."itemPostingGroup"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."itemPostingGroup"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."itemPostingGroup"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
  )
);

-- itemReplenishment

DROP POLICY IF EXISTS "Employees with part_view can view part costs" ON "public"."itemReplenishment";
DROP POLICY IF EXISTS "Employees with parts_update can update part costs" ON "public"."itemReplenishment";
DROP POLICY IF EXISTS "Suppliers with parts_view can view part replenishment they supply" ON "public"."itemReplenishment";
DROP POLICY IF EXISTS "Suppliers with parts_update can update parts replenishments that they supply" ON "public"."itemReplenishment";
DROP POLICY IF EXISTS "Requests with an API key can access item replenishment" ON "public"."itemReplenishment";

CREATE POLICY "SELECT" ON "public"."itemReplenishment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."itemReplenishment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."itemReplenishment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."itemReplenishment"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- itemUnitSalePrice

DROP POLICY IF EXISTS "Employees with part_view can view part sale prices" ON "public"."itemUnitSalePrice";
DROP POLICY IF EXISTS "Employees with parts_update can update part sale prices" ON "public"."itemUnitSalePrice";
DROP POLICY IF EXISTS "Requests with an API key can access item unit sale prices" ON "public"."itemUnitSalePrice";

CREATE POLICY "SELECT" ON "public"."itemUnitSalePrice"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('parts_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."itemUnitSalePrice"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."itemUnitSalePrice"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."itemUnitSalePrice"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- makeMethod

DROP POLICY IF EXISTS "Employees with parts_view can view make methods" ON "public"."makeMethod";
DROP POLICY IF EXISTS "Employees with parts_create can create make methods" ON "public"."makeMethod";
DROP POLICY IF EXISTS "Employees with parts_update can update make methods" ON "public"."makeMethod";
DROP POLICY IF EXISTS "Employees with parts_delete can delete make methods" ON "public"."makeMethod";
DROP POLICY IF EXISTS "Requests with an API key can access make methods" ON "public"."makeMethod";

CREATE POLICY "SELECT" ON "public"."makeMethod"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."makeMethod"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."makeMethod"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."makeMethod"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- methodMaterial

DROP POLICY IF EXISTS "Employees with parts_view can view method materials" ON "public"."methodMaterial";
DROP POLICY IF EXISTS "Employees with parts_create can create method materials" ON "public"."methodMaterial";
DROP POLICY IF EXISTS "Employees with parts_update can update method materials" ON "public"."methodMaterial";
DROP POLICY IF EXISTS "Employees with parts_delete can delete method materials" ON "public"."methodMaterial";
DROP POLICY IF EXISTS "Requests with an API key can access method materials" ON "public"."methodMaterial";

CREATE POLICY "SELECT" ON "public"."methodMaterial"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."methodMaterial"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."methodMaterial"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."methodMaterial"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- methodOperation

DROP POLICY IF EXISTS "Employees with parts_view can view method operation" ON "public"."methodOperation";
DROP POLICY IF EXISTS "Employees with parts_create can create method operation" ON "public"."methodOperation";
DROP POLICY IF EXISTS "Employees with parts_update can update method operation" ON "public"."methodOperation";
DROP POLICY IF EXISTS "Employees with parts_delete can delete method operation" ON "public"."methodOperation";
DROP POLICY IF EXISTS "Requests with an API key can access method operations" ON "public"."methodOperation";

CREATE POLICY "SELECT" ON "public"."methodOperation"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."methodOperation"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."methodOperation"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."methodOperation"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- modelUpload

DROP POLICY IF EXISTS "Employees can view model uploads" ON "public"."modelUpload";
DROP POLICY IF EXISTS "Employees with parts_create can create model uploads" ON "public"."modelUpload";
DROP POLICY IF EXISTS "Employees with parts_update can update model uploads" ON "public"."modelUpload";
DROP POLICY IF EXISTS "Employees with parts_delete can delete model uploads" ON "public"."modelUpload";
DROP POLICY IF EXISTS "Requests with an API key can access model uploads" ON "public"."modelUpload";

CREATE POLICY "SELECT" ON "public"."modelUpload"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."modelUpload"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."modelUpload"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."modelUpload"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- part

DROP POLICY IF EXISTS "Employees can view parts" ON "public"."part";
DROP POLICY IF EXISTS "Employees with parts_create can insert parts" ON "public"."part";
DROP POLICY IF EXISTS "Employees with parts_update can update parts" ON "public"."part";
DROP POLICY IF EXISTS "Employees with parts_delete can delete parts" ON "public"."part";
DROP POLICY IF EXISTS "Requests with an API key can access parts" ON "public"."part";

CREATE POLICY "SELECT" ON "public"."part"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."part"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."part"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."part"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- pickMethod

DROP POLICY IF EXISTS "Employees with part_view can view part planning" ON "public"."pickMethod";
DROP POLICY IF EXISTS "Employees with part_view can insert part planning" ON "public"."pickMethod";
DROP POLICY IF EXISTS "Employees with parts_update can update part planning" ON "public"."pickMethod";
DROP POLICY IF EXISTS "Requests with an API key can access pick methods" ON "public"."pickMethod";

CREATE POLICY "SELECT" ON "public"."pickMethod"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."pickMethod"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."pickMethod"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

-- service

DROP POLICY IF EXISTS "Employees can view services" ON "public"."service";
DROP POLICY IF EXISTS "Employees with parts_create can insert services" ON "public"."service";
DROP POLICY IF EXISTS "Employees with parts_update can update services" ON "public"."service";
DROP POLICY IF EXISTS "Employees with parts_delete can delete services" ON "public"."service";
DROP POLICY IF EXISTS "Requests with an API key can access services" ON "public"."service";

CREATE POLICY "SELECT" ON "public"."service"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."service"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."service"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."service"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- shelf

DROP POLICY IF EXISTS "Authenticated users can view shelves" ON "public"."shelf";
DROP POLICY IF EXISTS "Employees with parts_create can insert shelves" ON "public"."shelf";
DROP POLICY IF EXISTS "Employees with parts_update can update shelves" ON "public"."shelf";
DROP POLICY IF EXISTS "Employees with parts_delete can delete shelves" ON "public"."shelf";
DROP POLICY IF EXISTS "Requests with an API key can access shelves" ON "public"."shelf";

CREATE POLICY "SELECT" ON "public"."shelf"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."shelf"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."shelf"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."shelf"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- unitOfMeasure

DROP POLICY IF EXISTS "Employees can view units of measure" ON "public"."unitOfMeasure";
DROP POLICY IF EXISTS "Employees with parts_create can insert units of measure" ON "public"."unitOfMeasure";
DROP POLICY IF EXISTS "Employees with parts_update can update units of measure" ON "public"."unitOfMeasure";
DROP POLICY IF EXISTS "Employees with parts_delete can delete units of measure" ON "public"."unitOfMeasure";
DROP POLICY IF EXISTS "Requests with an API key can access units of measure" ON "public"."unitOfMeasure";

CREATE POLICY "SELECT" ON "public"."unitOfMeasure"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_any_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."unitOfMeasure"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."unitOfMeasure"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."unitOfMeasure"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- warehouse

DROP POLICY IF EXISTS "Employees can view warehouses" ON "public"."warehouse";
DROP POLICY IF EXISTS "Employees with parts_create can insert warehouses" ON "public"."warehouse";
DROP POLICY IF EXISTS "Employees with parts_update can update warehouses" ON "public"."warehouse";
DROP POLICY IF EXISTS "Employees with parts_delete can delete warehouses" ON "public"."warehouse";
DROP POLICY IF EXISTS "Requests with an API key can access warehouses" ON "public"."warehouse";

CREATE POLICY "SELECT" ON "public"."warehouse"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."warehouse"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."warehouse"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."warehouse"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- ============================================================================
-- Batch 3: Accounting
-- ============================================================================

-- journal

DROP POLICY IF EXISTS "Employees with accounting_view can view journals" ON "public"."journal";
DROP POLICY IF EXISTS "Employees with accounting_create can insert journals" ON "public"."journal";
DROP POLICY IF EXISTS "Requests with an API key can access journals" ON "public"."journal";

CREATE POLICY "SELECT" ON "public"."journal"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."journal"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
  )
);

-- journalLine

DROP POLICY IF EXISTS "Employees with accounting_view can view journal lines" ON "public"."journalLine";
DROP POLICY IF EXISTS "Employees with accounting_create can insert journal lines" ON "public"."journalLine";
DROP POLICY IF EXISTS "Requests with an API key can access journal lines" ON "public"."journalLine";

CREATE POLICY "SELECT" ON "public"."journalLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."journalLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
  )
);

-- paymentTerm

DROP POLICY IF EXISTS "Certain employees can view payment terms" ON "public"."paymentTerm";
DROP POLICY IF EXISTS "Employees with accounting_create can insert payment terms" ON "public"."paymentTerm";
DROP POLICY IF EXISTS "Employees with accounting_update can update payment terms" ON "public"."paymentTerm";
DROP POLICY IF EXISTS "Employees with accounting_delete can delete payment terms" ON "public"."paymentTerm";
DROP POLICY IF EXISTS "Requests with an API key can access payment terms" ON "public"."paymentTerm";

CREATE POLICY "SELECT" ON "public"."paymentTerm"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('accounting_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."paymentTerm"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."paymentTerm"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."paymentTerm"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
  )
);

-- postingGroupInventory

DROP POLICY IF EXISTS "Employees with accounting_view can view inventory posting groups" ON "public"."postingGroupInventory";
DROP POLICY IF EXISTS "Employees with accounting_update can update inventory posting groups" ON "public"."postingGroupInventory";
DROP POLICY IF EXISTS "Requests with an API key can access inventory posting groups" ON "public"."postingGroupInventory";

CREATE POLICY "SELECT" ON "public"."postingGroupInventory"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."postingGroupInventory"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
  )
);

-- postingGroupPurchasing

DROP POLICY IF EXISTS "Employees with accounting_view can view purchasing posting groups" ON "public"."postingGroupPurchasing";
DROP POLICY IF EXISTS "Employees with accounting_update can update purchasing posting groups" ON "public"."postingGroupPurchasing";
DROP POLICY IF EXISTS "Requests with an API key can access purchasing posting groups" ON "public"."postingGroupPurchasing";

CREATE POLICY "SELECT" ON "public"."postingGroupPurchasing"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."postingGroupPurchasing"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
  )
);

-- postingGroupSales

DROP POLICY IF EXISTS "Employees with accounting_view can view sales posting groups" ON "public"."postingGroupSales";
DROP POLICY IF EXISTS "Employees with accounting_update can update sales posting groups" ON "public"."postingGroupSales";
DROP POLICY IF EXISTS "Requests with an API key can access sales posting groups" ON "public"."postingGroupSales";

CREATE POLICY "SELECT" ON "public"."postingGroupSales"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."postingGroupSales"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
  )
);

-- supplierLedger

DROP POLICY IF EXISTS "Certain employees can view the parts ledger" ON "public"."supplierLedger";
DROP POLICY IF EXISTS "Requests with an API key can access supplier ledger" ON "public"."supplierLedger";

CREATE POLICY "SELECT" ON "public"."supplierLedger"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('accounting_view'))::text[]
  )
);

-- ============================================================================
-- Batch 4: Production
-- ============================================================================

-- job (policies were refactored in 20250707135534 with customer checks - removing those)

DROP POLICY IF EXISTS "SELECT" ON "public"."job";
DROP POLICY IF EXISTS "INSERT" ON "public"."job";
DROP POLICY IF EXISTS "UPDATE" ON "public"."job";
DROP POLICY IF EXISTS "DELETE" ON "public"."job";

CREATE POLICY "SELECT" ON "public"."job"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."job"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."job"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."job"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_delete'))::text[]
  )
);

-- jobMakeMethod

DROP POLICY IF EXISTS "Requests with an API key can access jobs" ON "public"."jobMakeMethod";
DROP POLICY IF EXISTS "Employees can view job make methods" ON "public"."jobMakeMethod";
DROP POLICY IF EXISTS "Employees with production_create can insert job make methods" ON "public"."jobMakeMethod";
DROP POLICY IF EXISTS "Employees with production_update can update job make methods" ON "public"."jobMakeMethod";
DROP POLICY IF EXISTS "Employees with production_delete can delete job make methods" ON "public"."jobMakeMethod";
DROP POLICY IF EXISTS "Customers with production_view can view their own job make methods" ON "public"."jobMakeMethod";

CREATE POLICY "SELECT" ON "public"."jobMakeMethod"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobMakeMethod"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobMakeMethod"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobMakeMethod"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_delete'))::text[]
  )
);

-- jobMaterial (policies were refactored in 20250707135534 with customer checks - removing those)

DROP POLICY IF EXISTS "SELECT" ON "public"."jobMaterial";
DROP POLICY IF EXISTS "INSERT" ON "public"."jobMaterial";
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobMaterial";
DROP POLICY IF EXISTS "DELETE" ON "public"."jobMaterial";

CREATE POLICY "SELECT" ON "public"."jobMaterial"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobMaterial"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobMaterial"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobMaterial"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_delete'))::text[]
  )
);

-- jobOperation (policies were refactored in 20250707135534 with customer checks - removing those)

DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperation";
DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperation";
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperation";
DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperation";

CREATE POLICY "SELECT" ON "public"."jobOperation"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperation"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperation"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperation"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_delete'))::text[]
  )
);

-- productionEvent

DROP POLICY IF EXISTS "Requests with an API key can access production events" ON "public"."productionEvent";
DROP POLICY IF EXISTS "Employees can view their own production events" ON "public"."productionEvent";
DROP POLICY IF EXISTS "Users with production_view can see all production events" ON "public"."productionEvent";
DROP POLICY IF EXISTS "Users with production_create can insert production events" ON "public"."productionEvent";
DROP POLICY IF EXISTS "Users with production_update can update production events" ON "public"."productionEvent";
DROP POLICY IF EXISTS "Users with production_delete can delete production events" ON "public"."productionEvent";
DROP POLICY IF EXISTS "Employees can insert production events for their company's job operations" ON "public"."productionEvent";
DROP POLICY IF EXISTS "Employees can update production events for their company's job operations" ON "public"."productionEvent";

CREATE POLICY "SELECT" ON "public"."productionEvent"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."productionEvent"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."productionEvent"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."productionEvent"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_delete'))::text[]
  )
);

-- productionQuantity

DROP POLICY IF EXISTS "Employees can view production quantities" ON "public"."productionQuantity";
DROP POLICY IF EXISTS "Employees can insert production quantities" ON "public"."productionQuantity";
DROP POLICY IF EXISTS "Employees can update production quantities" ON "public"."productionQuantity";
DROP POLICY IF EXISTS "Employees can delete production quantities" ON "public"."productionQuantity";
DROP POLICY IF EXISTS "Employees can insert production quantities for their company's job operations" ON "public"."productionQuantity";

CREATE POLICY "SELECT" ON "public"."productionQuantity"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."productionQuantity"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."productionQuantity"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."productionQuantity"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_delete'))::text[]
  )
);

-- scrapReason

DROP POLICY IF EXISTS "Employees can view scrap reasons" ON "public"."scrapReason";
DROP POLICY IF EXISTS "Employees with production_create can insert scrap reasons" ON "public"."scrapReason";
DROP POLICY IF EXISTS "Employees with production_update can update scrap reasons" ON "public"."scrapReason";
DROP POLICY IF EXISTS "Employees with production_delete can delete scrap reasons" ON "public"."scrapReason";

CREATE POLICY "SELECT" ON "public"."scrapReason"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."scrapReason"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."scrapReason"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."scrapReason"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_delete'))::text[]
  )
);

-- ============================================================================
-- Batch 5: Purchasing
-- ============================================================================

-- purchaseOrder

DROP POLICY IF EXISTS "Employees with purchasing_view, inventory_view, or invoicing_view can view purchase orders" ON "public"."purchaseOrder";
DROP POLICY IF EXISTS "Employees with purchasing_create can create purchase orders" ON "public"."purchaseOrder";
DROP POLICY IF EXISTS "Employees with purchasing_update can update purchase orders" ON "public"."purchaseOrder";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete purchase orders" ON "public"."purchaseOrder";
DROP POLICY IF EXISTS "Suppliers with purchasing_view can their own purchase orders" ON "public"."purchaseOrder";
DROP POLICY IF EXISTS "Suppliers with purchasing_update can their own purchase orders" ON "public"."purchaseOrder";
DROP POLICY IF EXISTS "Requests with an API key can access purchase orders" ON "public"."purchaseOrder";

CREATE POLICY "SELECT" ON "public"."purchaseOrder"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('inventory_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('invoicing_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."purchaseOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."purchaseOrder"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."purchaseOrder"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- purchaseOrderDelivery

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchase order deliveries" ON "public"."purchaseOrderDelivery";
DROP POLICY IF EXISTS "Employees with purchasing_create can create purchase order deliveries" ON "public"."purchaseOrderDelivery";
DROP POLICY IF EXISTS "Employees with purchasing_update can update purchase order deliveries" ON "public"."purchaseOrderDelivery";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete purchase order deliveries" ON "public"."purchaseOrderDelivery";
DROP POLICY IF EXISTS "Suppliers with purchasing_view can their own purchase order deliveries" ON "public"."purchaseOrderDelivery";
DROP POLICY IF EXISTS "Suppliers with purchasing_update can their own purchase order deliveries" ON "public"."purchaseOrderDelivery";
DROP POLICY IF EXISTS "Requests with an API key can access purchase order deliveries" ON "public"."purchaseOrderDelivery";

CREATE POLICY "SELECT" ON "public"."purchaseOrderDelivery"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."purchaseOrderDelivery"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."purchaseOrderDelivery"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."purchaseOrderDelivery"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- purchaseOrderLine

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchase order lines" ON "public"."purchaseOrderLine";
DROP POLICY IF EXISTS "Employees with purchasing_create can create purchase order lines" ON "public"."purchaseOrderLine";
DROP POLICY IF EXISTS "Employees with purchasing_update can update purchase order lines" ON "public"."purchaseOrderLine";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete purchase order lines" ON "public"."purchaseOrderLine";
DROP POLICY IF EXISTS "Suppliers with purchasing_view can their own purchase order lines" ON "public"."purchaseOrderLine";
DROP POLICY IF EXISTS "Suppliers with purchasing_create can create lines on their own purchase order" ON "public"."purchaseOrderLine";
DROP POLICY IF EXISTS "Suppliers with purchasing_update can their own purchase order lines" ON "public"."purchaseOrderLine";
DROP POLICY IF EXISTS "Suppliers with purchasing_delete can delete lines on their own purchase order" ON "public"."purchaseOrderLine";
DROP POLICY IF EXISTS "Requests with an API key can access purchase order lines" ON "public"."purchaseOrderLine";

CREATE POLICY "SELECT" ON "public"."purchaseOrderLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."purchaseOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."purchaseOrderLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."purchaseOrderLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- purchaseOrderPayment

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchase order payments" ON "public"."purchaseOrderPayment";
DROP POLICY IF EXISTS "Employees with purchasing_create can create purchase order payments" ON "public"."purchaseOrderPayment";
DROP POLICY IF EXISTS "Employees with purchasing_update can update purchase order payments" ON "public"."purchaseOrderPayment";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete purchase order payments" ON "public"."purchaseOrderPayment";
DROP POLICY IF EXISTS "Requests with an API key can access purchase order payments" ON "public"."purchaseOrderPayment";

CREATE POLICY "SELECT" ON "public"."purchaseOrderPayment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."purchaseOrderPayment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."purchaseOrderPayment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."purchaseOrderPayment"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- purchaseOrderStatusHistory (no companyId - uses FK lookup)

DROP POLICY IF EXISTS "Users can view purchase order status history" ON "public"."purchaseOrderStatusHistory";
DROP POLICY IF EXISTS "Users can insert purchase order status history" ON "public"."purchaseOrderStatusHistory";
DROP POLICY IF EXISTS "Employees with purchasing_view can view purchase order status history" ON "public"."purchaseOrderStatusHistory";
DROP POLICY IF EXISTS "Requests with an API key can access purchase order status history" ON "public"."purchaseOrderStatusHistory";

CREATE POLICY "SELECT" ON "public"."purchaseOrderStatusHistory"
FOR SELECT USING (
  get_company_id_from_foreign_key("purchaseOrderId", 'purchaseOrder') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

-- purchaseOrderTransaction (no companyId - uses FK lookup)

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchase order transactions" ON "public"."purchaseOrderTransaction";
DROP POLICY IF EXISTS "User with purchasing_update can insert purchase order transactions" ON "public"."purchaseOrderTransaction";
DROP POLICY IF EXISTS "Requests with an API key can access purchase order transactions" ON "public"."purchaseOrderTransaction";

CREATE POLICY "SELECT" ON "public"."purchaseOrderTransaction"
FOR SELECT USING (
  get_company_id_from_foreign_key("purchaseOrderId", 'purchaseOrder') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."purchaseOrderTransaction"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("purchaseOrderId", 'purchaseOrder') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

-- ============================================================================
-- Batch 6: Invoicing
-- ============================================================================

-- purchaseInvoice

DROP POLICY IF EXISTS "Employees with invoicing_view can view AP invoices" ON "public"."purchaseInvoice";
DROP POLICY IF EXISTS "Employees with invoicing_create can insert AP invoices" ON "public"."purchaseInvoice";
DROP POLICY IF EXISTS "Employees with invoicing_update can update AP invoices" ON "public"."purchaseInvoice";
DROP POLICY IF EXISTS "Employees with invoicing_delete can delete AP invoices" ON "public"."purchaseInvoice";
DROP POLICY IF EXISTS "Requests with an API key can access purchase invoices" ON "public"."purchaseInvoice";

CREATE POLICY "SELECT" ON "public"."purchaseInvoice"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."purchaseInvoice"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."purchaseInvoice"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."purchaseInvoice"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

-- purchaseInvoiceDelivery

DROP POLICY IF EXISTS "Employees with invoicing_view can view purchase invoice deliveries" ON "public"."purchaseInvoiceDelivery";
DROP POLICY IF EXISTS "Employees with invoicing_create can insert purchase invoice deliveries" ON "public"."purchaseInvoiceDelivery";
DROP POLICY IF EXISTS "Employees with invoicing_update can update purchase invoice deliveries" ON "public"."purchaseInvoiceDelivery";
DROP POLICY IF EXISTS "Employees with invoicing_delete can delete purchase invoice deliveries" ON "public"."purchaseInvoiceDelivery";

CREATE POLICY "SELECT" ON "public"."purchaseInvoiceDelivery"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."purchaseInvoiceDelivery"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."purchaseInvoiceDelivery"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."purchaseInvoiceDelivery"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

-- purchaseInvoiceLine

DROP POLICY IF EXISTS "Employees with invoicing_view can view AP invoice lines" ON "public"."purchaseInvoiceLine";
DROP POLICY IF EXISTS "Employees with invoicing_create can insert AP invoice lines" ON "public"."purchaseInvoiceLine";
DROP POLICY IF EXISTS "Employees with invoicing_update can update AP invoice lines" ON "public"."purchaseInvoiceLine";
DROP POLICY IF EXISTS "Employees with invoicing_delete can delete AP invoice lines" ON "public"."purchaseInvoiceLine";
DROP POLICY IF EXISTS "Requests with an API key can access purchase invoice lines" ON "public"."purchaseInvoiceLine";

CREATE POLICY "SELECT" ON "public"."purchaseInvoiceLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."purchaseInvoiceLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."purchaseInvoiceLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."purchaseInvoiceLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

-- purchaseInvoicePaymentRelation (no companyId - uses FK lookup, SELECT only)

DROP POLICY IF EXISTS "Employees with invoicing_view can view AP invoice/payment relations" ON "public"."purchaseInvoicePaymentRelation";
DROP POLICY IF EXISTS "Requests with an API key can access purchase invoice payment relations" ON "public"."purchaseInvoicePaymentRelation";

CREATE POLICY "SELECT" ON "public"."purchaseInvoicePaymentRelation"
FOR SELECT USING (
  get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice') = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_view'))::text[]
  )
);

-- purchaseInvoicePriceChange (no companyId - uses FK lookup, SELECT only)

DROP POLICY IF EXISTS "Employees with invoicing_view can view AP invoice price changes" ON "public"."purchaseInvoicePriceChange";
DROP POLICY IF EXISTS "Requests with an API key can access purchase invoice price changes" ON "public"."purchaseInvoicePriceChange";

CREATE POLICY "SELECT" ON "public"."purchaseInvoicePriceChange"
FOR SELECT USING (
  get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice') = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_view'))::text[]
  )
);

-- purchaseInvoiceStatusHistory (no companyId - uses FK lookup, SELECT only)

DROP POLICY IF EXISTS "Employees with invoicing_view can view AP invoices status history" ON "public"."purchaseInvoiceStatusHistory";
DROP POLICY IF EXISTS "Requests with an API key can access purchase invoice status history" ON "public"."purchaseInvoiceStatusHistory";

CREATE POLICY "SELECT" ON "public"."purchaseInvoiceStatusHistory"
FOR SELECT USING (
  get_company_id_from_foreign_key("invoiceId", 'purchaseInvoice') = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_view'))::text[]
  )
);

-- purchasePayment

DROP POLICY IF EXISTS "Employees with invoicing_view can view AP payments" ON "public"."purchasePayment";
DROP POLICY IF EXISTS "Employees with invoicing_create can insert AP payments" ON "public"."purchasePayment";
DROP POLICY IF EXISTS "Employees with invoicing_update can update AP payments" ON "public"."purchasePayment";
DROP POLICY IF EXISTS "Employees with invoicing_delete can delete AP payments" ON "public"."purchasePayment";
DROP POLICY IF EXISTS "Requests with an API key can access purchase payments" ON "public"."purchasePayment";

CREATE POLICY "SELECT" ON "public"."purchasePayment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."purchasePayment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."purchasePayment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."purchasePayment"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

-- ============================================================================
-- Batch 7: Sales - Quotes
-- ============================================================================

-- noQuoteReason (has new-style policies from a later migration)

DROP POLICY IF EXISTS "Employees can view no quote reasons" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "Employees with sales_create can insert no quote reasons" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "Employees with sales_update can update no quote reasons" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "Employees with sales_delete can delete no quote reasons" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "SELECT" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "INSERT" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "UPDATE" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "DELETE" ON "public"."noQuoteReason";

CREATE POLICY "SELECT" ON "public"."noQuoteReason"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."noQuoteReason"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."noQuoteReason"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."noQuoteReason"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- opportunity

DROP POLICY IF EXISTS "Employees with sales_view can view opportunities" ON "public"."opportunity";
DROP POLICY IF EXISTS "Employees with sales_create can insert opportunities" ON "public"."opportunity";
DROP POLICY IF EXISTS "Employees with sales_create can update opportunities" ON "public"."opportunity";
DROP POLICY IF EXISTS "Requests with an API key can access opportunities" ON "public"."opportunity";
DROP POLICY IF EXISTS "SELECT" ON "public"."opportunity";
DROP POLICY IF EXISTS "INSERT" ON "public"."opportunity";
DROP POLICY IF EXISTS "UPDATE" ON "public"."opportunity";
DROP POLICY IF EXISTS "DELETE" ON "public"."opportunity";

CREATE POLICY "SELECT" ON "public"."opportunity"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."opportunity"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."opportunity"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

-- quote

DROP POLICY IF EXISTS "Employees with sales_view can view quotes" ON "public"."quote";
DROP POLICY IF EXISTS "Employees with sales_create can create quotes" ON "public"."quote";
DROP POLICY IF EXISTS "Employees with sales_update can update quotes" ON "public"."quote";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quotes" ON "public"."quote";
DROP POLICY IF EXISTS "Customers with sales_view can their own quotes" ON "public"."quote";
DROP POLICY IF EXISTS "Customers with sales_update can their own quotes" ON "public"."quote";
DROP POLICY IF EXISTS "Requests with an API key can access quotes" ON "public"."quote";
DROP POLICY IF EXISTS "SELECT" ON "public"."quote";
DROP POLICY IF EXISTS "INSERT" ON "public"."quote";
DROP POLICY IF EXISTS "UPDATE" ON "public"."quote";
DROP POLICY IF EXISTS "DELETE" ON "public"."quote";

CREATE POLICY "SELECT" ON "public"."quote"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quote"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quote"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quote"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- quoteFavorite (user-scoped, no companyId)

DROP POLICY IF EXISTS "Users can view their own quote favorites" ON "public"."quoteFavorite";
DROP POLICY IF EXISTS "Users can create their own quote favorites" ON "public"."quoteFavorite";
DROP POLICY IF EXISTS "Users can delete their own quote favorites" ON "public"."quoteFavorite";
DROP POLICY IF EXISTS "Requests with an API key can access quote favorites" ON "public"."quoteFavorite";

CREATE POLICY "SELECT" ON "public"."quoteFavorite"
FOR SELECT USING ((SELECT auth.uid())::text = "userId");

CREATE POLICY "INSERT" ON "public"."quoteFavorite"
FOR INSERT WITH CHECK ((SELECT auth.uid())::text = "userId");

CREATE POLICY "DELETE" ON "public"."quoteFavorite"
FOR DELETE USING ((SELECT auth.uid())::text = "userId");

-- quoteLine

DROP POLICY IF EXISTS "Employees with sales_view can view quote lines" ON "public"."quoteLine";
DROP POLICY IF EXISTS "Employees with sales_create can create quote lines" ON "public"."quoteLine";
DROP POLICY IF EXISTS "Employees with sales_update can update quote lines" ON "public"."quoteLine";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote lines" ON "public"."quoteLine";
DROP POLICY IF EXISTS "Customers with sales_view can their own quote lines" ON "public"."quoteLine";
DROP POLICY IF EXISTS "Customers with sales_create can create lines on their own quote" ON "public"."quoteLine";
DROP POLICY IF EXISTS "Customers with sales_update can their own quote lines" ON "public"."quoteLine";
DROP POLICY IF EXISTS "Customers with sales_delete can delete lines on their own quote" ON "public"."quoteLine";
DROP POLICY IF EXISTS "Requests with an API key can access quote lines" ON "public"."quoteLine";
DROP POLICY IF EXISTS "SELECT" ON "public"."quoteLine";
DROP POLICY IF EXISTS "INSERT" ON "public"."quoteLine";
DROP POLICY IF EXISTS "UPDATE" ON "public"."quoteLine";
DROP POLICY IF EXISTS "DELETE" ON "public"."quoteLine";

CREATE POLICY "SELECT" ON "public"."quoteLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- quoteLinePrice (FK via quoteLineId -> quoteLine)

DROP POLICY IF EXISTS "Employees with sales_view can view quote line pricing" ON "public"."quoteLinePrice";
DROP POLICY IF EXISTS "Employees with sales_create can insert quote line pricing" ON "public"."quoteLinePrice";
DROP POLICY IF EXISTS "Employees with sales_update can update quote line pricing" ON "public"."quoteLinePrice";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote line pricing" ON "public"."quoteLinePrice";
DROP POLICY IF EXISTS "Requests with an API key can access quote line prices" ON "public"."quoteLinePrice";

CREATE POLICY "SELECT" ON "public"."quoteLinePrice"
FOR SELECT USING (
  get_company_id_from_foreign_key("quoteLineId", 'quoteLine') = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteLinePrice"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("quoteLineId", 'quoteLine') = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteLinePrice"
FOR UPDATE USING (
  get_company_id_from_foreign_key("quoteLineId", 'quoteLine') = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteLinePrice"
FOR DELETE USING (
  get_company_id_from_foreign_key("quoteLineId", 'quoteLine') = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- quoteMakeMethod

DROP POLICY IF EXISTS "Employees with sales_view can view quote make methods" ON "public"."quoteMakeMethod";
DROP POLICY IF EXISTS "Customers with sales_view can their own quote make methods" ON "public"."quoteMakeMethod";
DROP POLICY IF EXISTS "Employees with sales_create can create quote make methods" ON "public"."quoteMakeMethod";
DROP POLICY IF EXISTS "Employees with sales_update can update quote make methods" ON "public"."quoteMakeMethod";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote make methods" ON "public"."quoteMakeMethod";
DROP POLICY IF EXISTS "Requests with an API key can access quote make methods" ON "public"."quoteMakeMethod";

CREATE POLICY "SELECT" ON "public"."quoteMakeMethod"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteMakeMethod"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteMakeMethod"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteMakeMethod"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- quoteMaterial

DROP POLICY IF EXISTS "Employees with sales_view can view quote materials" ON "public"."quoteMaterial";
DROP POLICY IF EXISTS "Employees with sales_create can create quote materials" ON "public"."quoteMaterial";
DROP POLICY IF EXISTS "Employees with sales_update can update quote materials" ON "public"."quoteMaterial";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote materials" ON "public"."quoteMaterial";
DROP POLICY IF EXISTS "Requests with an API key can access quote materials" ON "public"."quoteMaterial";

CREATE POLICY "SELECT" ON "public"."quoteMaterial"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteMaterial"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteMaterial"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteMaterial"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- quoteOperation

DROP POLICY IF EXISTS "Employees with sales_view can view quote operations" ON "public"."quoteOperation";
DROP POLICY IF EXISTS "Employees with sales_create can create quote operations" ON "public"."quoteOperation";
DROP POLICY IF EXISTS "Employees with sales_update can update quote operations" ON "public"."quoteOperation";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote operations" ON "public"."quoteOperation";
DROP POLICY IF EXISTS "Requests with an API key can access quote operations" ON "public"."quoteOperation";

CREATE POLICY "SELECT" ON "public"."quoteOperation"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteOperation"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteOperation"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteOperation"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- quotePayment

DROP POLICY IF EXISTS "Employees with sales_view can view quote payments" ON "public"."quotePayment";
DROP POLICY IF EXISTS "Employees with sales_create can create quote payments" ON "public"."quotePayment";
DROP POLICY IF EXISTS "Employees with sales_update can update quote payments" ON "public"."quotePayment";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote payments" ON "public"."quotePayment";
DROP POLICY IF EXISTS "Requests with an API can access quote payments" ON "public"."quotePayment";


-- quoteShipment

DROP POLICY IF EXISTS "Employees with sales_view can view quote shipments" ON "public"."quoteShipment";
DROP POLICY IF EXISTS "Employees with sales_create can create quote shipments" ON "public"."quoteShipment";
DROP POLICY IF EXISTS "Employees with sales_update can update quote shipments" ON "public"."quoteShipment";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote shipments" ON "public"."quoteShipment";
DROP POLICY IF EXISTS "Requests with an API can access quote shipments" ON "public"."quoteShipment";


-- ============================================================================
-- Batch 8: Sales - Orders & RFQs
-- ============================================================================

-- salesOrder (multi-permission SELECT)

DROP POLICY IF EXISTS "Employees with sales_view, inventory_view, or invoicing_view can view sales orders" ON "public"."salesOrder";
DROP POLICY IF EXISTS "Employees with sales_create can create sales orders" ON "public"."salesOrder";
DROP POLICY IF EXISTS "Employees with sales_update can update sales orders" ON "public"."salesOrder";
DROP POLICY IF EXISTS "Employees with sales_delete can delete sales orders" ON "public"."salesOrder";
DROP POLICY IF EXISTS "Customers with sales_view can their own sales orders" ON "public"."salesOrder";
DROP POLICY IF EXISTS "Customers with sales_create can create lines on their own sales order" ON "public"."salesOrder";
DROP POLICY IF EXISTS "Customers with sales_update can update their own sales orders" ON "public"."salesOrder";
DROP POLICY IF EXISTS "Customers with sales_delete can delete lines on their own sales order" ON "public"."salesOrder";
DROP POLICY IF EXISTS "Requests with an API key can access requests for sales order" ON "public"."salesOrder";
DROP POLICY IF EXISTS "SELECT" ON "public"."salesOrder";
DROP POLICY IF EXISTS "INSERT" ON "public"."salesOrder";
DROP POLICY IF EXISTS "UPDATE" ON "public"."salesOrder";
DROP POLICY IF EXISTS "DELETE" ON "public"."salesOrder";

CREATE POLICY "SELECT" ON "public"."salesOrder"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('inventory_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('invoicing_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."salesOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."salesOrder"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."salesOrder"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- salesOrderFavorite (user-scoped, no companyId)

DROP POLICY IF EXISTS "Users can view their own sales order favorites" ON "public"."salesOrderFavorite";
DROP POLICY IF EXISTS "Users can create their own sales order favorites" ON "public"."salesOrderFavorite";
DROP POLICY IF EXISTS "Users can delete their own sales order favorites" ON "public"."salesOrderFavorite";
DROP POLICY IF EXISTS "Requests with an API key can access requests for sales order favorites" ON "public"."salesOrderFavorite";

CREATE POLICY "SELECT" ON "public"."salesOrderFavorite"
FOR SELECT USING ((SELECT auth.uid())::text = "userId");

CREATE POLICY "INSERT" ON "public"."salesOrderFavorite"
FOR INSERT WITH CHECK ((SELECT auth.uid())::text = "userId");

CREATE POLICY "DELETE" ON "public"."salesOrderFavorite"
FOR DELETE USING ((SELECT auth.uid())::text = "userId");

-- salesOrderLine

DROP POLICY IF EXISTS "Employees with sales_view can view sales order lines" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "Employees with sales_create can create sales order lines" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "Employees with sales_update can update sales order lines" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "Employees with sales_delete can delete sales order lines" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "Customers with sales_view can their own sales order lines" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "Customers with sales_create can create lines on their own sales order" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "Customers with sales_update can update their own sales order lines" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "Customers with sales_delete can delete lines on their own sales order" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "Requests with an API key can access requests for sales order lines" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "SELECT" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "INSERT" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "UPDATE" ON "public"."salesOrderLine";
DROP POLICY IF EXISTS "DELETE" ON "public"."salesOrderLine";

CREATE POLICY "SELECT" ON "public"."salesOrderLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."salesOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."salesOrderLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."salesOrderLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- salesOrderShipment

DROP POLICY IF EXISTS "Employees with sales_view can view sales order shipments" ON "public"."salesOrderShipment";
DROP POLICY IF EXISTS "Employees with sales_create can create sales order shipments" ON "public"."salesOrderShipment";
DROP POLICY IF EXISTS "Employees with sales_update can update sales order shipments" ON "public"."salesOrderShipment";
DROP POLICY IF EXISTS "Employees with sales_delete can delete sales order shipments" ON "public"."salesOrderShipment";
DROP POLICY IF EXISTS "Customers with sales_view can their own sales order shipments" ON "public"."salesOrderShipment";
DROP POLICY IF EXISTS "Customers with sales_update can their own sales order shipments" ON "public"."salesOrderShipment";
DROP POLICY IF EXISTS "Requests with an API key can access requests for sales order shipments" ON "public"."salesOrderShipment";


-- salesOrderStatusHistory (FK via salesOrderId -> salesOrder, SELECT only)

DROP POLICY IF EXISTS "Anyone with sales_view can view sales order status history" ON "public"."salesOrderStatusHistory";
DROP POLICY IF EXISTS "Requests with an API key can access requests for sales order status history" ON "public"."salesOrderStatusHistory";

CREATE POLICY "SELECT" ON "public"."salesOrderStatusHistory"
FOR SELECT USING (
  get_company_id_from_foreign_key("salesOrderId", 'salesOrder') = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

-- salesOrderTransaction (FK via salesOrderId -> salesOrder, SELECT + INSERT only)

DROP POLICY IF EXISTS "Requests with an API key can access sales order transactions" ON "public"."salesOrderTransaction";

CREATE POLICY "SELECT" ON "public"."salesOrderTransaction"
FOR SELECT USING (
  get_company_id_from_foreign_key("salesOrderId", 'salesOrder') = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."salesOrderTransaction"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("salesOrderId", 'salesOrder') = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

-- salesRfq

DROP POLICY IF EXISTS "Employees with sales_view can view sales rfqs" ON "public"."salesRfq";
DROP POLICY IF EXISTS "Employees with sales_create can create sales rfqs" ON "public"."salesRfq";
DROP POLICY IF EXISTS "Employees with sales_update can edit sales rfqs" ON "public"."salesRfq";
DROP POLICY IF EXISTS "Employees with sales_delete can delete sales rfqs" ON "public"."salesRfq";
DROP POLICY IF EXISTS "Customer with sales_view can view their own sales rfqs" ON "public"."salesRfq";
DROP POLICY IF EXISTS "Requests with an API key can access sales RFQs" ON "public"."salesRfq";
DROP POLICY IF EXISTS "SELECT" ON "public"."salesRfq";
DROP POLICY IF EXISTS "INSERT" ON "public"."salesRfq";
DROP POLICY IF EXISTS "UPDATE" ON "public"."salesRfq";
DROP POLICY IF EXISTS "DELETE" ON "public"."salesRfq";

CREATE POLICY "SELECT" ON "public"."salesRfq"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."salesRfq"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."salesRfq"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."salesRfq"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- salesRfqFavorite (user-scoped, no companyId)

DROP POLICY IF EXISTS "Users can view their own salesRfq favorites" ON "public"."salesRfqFavorite";
DROP POLICY IF EXISTS "Users can create their own salesRfq favorites" ON "public"."salesRfqFavorite";
DROP POLICY IF EXISTS "Users can delete their own salesRfq favorites" ON "public"."salesRfqFavorite";
DROP POLICY IF EXISTS "Requests with an API key can access sales RFQ favorites" ON "public"."salesRfqFavorite";

CREATE POLICY "SELECT" ON "public"."salesRfqFavorite"
FOR SELECT USING ((SELECT auth.uid())::text = "userId");

CREATE POLICY "INSERT" ON "public"."salesRfqFavorite"
FOR INSERT WITH CHECK ((SELECT auth.uid())::text = "userId");

CREATE POLICY "DELETE" ON "public"."salesRfqFavorite"
FOR DELETE USING ((SELECT auth.uid())::text = "userId");

-- salesRfqLine

DROP POLICY IF EXISTS "Employees with sales_view can view sales rfq lines" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Employees with sales_create can create sales rfq lines" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Employees with sales_update can edit sales rfq lines" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Employees with sales_delete can delete sales rfq lines" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Employees with sales_create can insert salesRfqLine" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Employees with sales_delete can delete salesRfqLine" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Employees with sales_update can update salesRfqLine" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Employees with sales_view can view salesRfqLine" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Customers with sales_view can their own purchase order lines" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "Requests with an API key can access sales RFQ lines" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "SELECT" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "INSERT" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "UPDATE" ON "public"."salesRfqLine";
DROP POLICY IF EXISTS "DELETE" ON "public"."salesRfqLine";

CREATE POLICY "SELECT" ON "public"."salesRfqLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."salesRfqLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."salesRfqLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."salesRfqLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
  )
);

-- ============================================================================
-- Batch 9: Supplier
-- ============================================================================

-- supplier

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier" ON "public"."supplier";
DROP POLICY IF EXISTS "Suppliers with purchasing_view can their own organization" ON "public"."supplier";
DROP POLICY IF EXISTS "Employees with purchasing_create can create suppliers" ON "public"."supplier";
DROP POLICY IF EXISTS "Employees with purchasing_update can update suppliers" ON "public"."supplier";
DROP POLICY IF EXISTS "Suppliers with purchasing_update can update their own organization" ON "public"."supplier";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete suppliers" ON "public"."supplier";
DROP POLICY IF EXISTS "Requests with an API key can access suppliers" ON "public"."supplier";

CREATE POLICY "SELECT" ON "public"."supplier"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplier"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplier"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplier"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierAccount

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier accounts" ON "public"."supplierAccount";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier accounts" ON "public"."supplierAccount";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier accounts" ON "public"."supplierAccount";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier accounts" ON "public"."supplierAccount";
DROP POLICY IF EXISTS "Requests with an API key can access supplier accounts" ON "public"."supplierAccount";

CREATE POLICY "SELECT" ON "public"."supplierAccount"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierAccount"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierAccount"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierContact (FK via supplierId -> supplier)

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier contact" ON "public"."supplierContact";
DROP POLICY IF EXISTS "Suppliers with purchasing_view can their own supplier contacts" ON "public"."supplierContact";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier contacts" ON "public"."supplierContact";
DROP POLICY IF EXISTS "Suppliers with purchasing_create can create supplier contacts" ON "public"."supplierContact";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier contacts" ON "public"."supplierContact";
DROP POLICY IF EXISTS "Suppliers with purchasing_update can update their supplier contacts" ON "public"."supplierContact";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier contacts" ON "public"."supplierContact";
DROP POLICY IF EXISTS "Requests with an API key can access supplier contacts" ON "public"."supplierContact";

CREATE POLICY "SELECT" ON "public"."supplierContact"
FOR SELECT USING (
  get_company_id_from_foreign_key("supplierId", 'supplier') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierContact"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("supplierId", 'supplier') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierContact"
FOR UPDATE USING (
  get_company_id_from_foreign_key("supplierId", 'supplier') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierContact"
FOR DELETE USING (
  get_company_id_from_foreign_key("supplierId", 'supplier') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierInteraction (has both old and new-style policies)

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier interactions" ON "public"."supplierInteraction";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier interactions" ON "public"."supplierInteraction";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier interactions" ON "public"."supplierInteraction";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier interactions" ON "public"."supplierInteraction";
DROP POLICY IF EXISTS "Requests with an API key can access supplier interactions" ON "public"."supplierInteraction";
DROP POLICY IF EXISTS "SELECT" ON "public"."supplierInteraction";
DROP POLICY IF EXISTS "INSERT" ON "public"."supplierInteraction";
DROP POLICY IF EXISTS "UPDATE" ON "public"."supplierInteraction";
DROP POLICY IF EXISTS "DELETE" ON "public"."supplierInteraction";

CREATE POLICY "SELECT" ON "public"."supplierInteraction"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierInteraction"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierInteraction"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierInteraction"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierLocation (FK via supplierId -> supplier)

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier locations" ON "public"."supplierLocation";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier locations" ON "public"."supplierLocation";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier locations" ON "public"."supplierLocation";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier locations" ON "public"."supplierLocation";
DROP POLICY IF EXISTS "Requests with an API key can access supplier locations" ON "public"."supplierLocation";

CREATE POLICY "SELECT" ON "public"."supplierLocation"
FOR SELECT USING (
  get_company_id_from_foreign_key("supplierId", 'supplier') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierLocation"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("supplierId", 'supplier') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierLocation"
FOR UPDATE USING (
  get_company_id_from_foreign_key("supplierId", 'supplier') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierLocation"
FOR DELETE USING (
  get_company_id_from_foreign_key("supplierId", 'supplier') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierPayment (SELECT + UPDATE only)

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier payment" ON "public"."supplierPayment";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier payment" ON "public"."supplierPayment";
DROP POLICY IF EXISTS "Requests with an API key can access supplier payments" ON "public"."supplierPayment";

CREATE POLICY "SELECT" ON "public"."supplierPayment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierPayment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

-- supplierQuote

DROP POLICY IF EXISTS "Employees with purchasing_view or purchasing_view can view supplier quotes" ON "public"."supplierQuote";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier quotes" ON "public"."supplierQuote";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier quotes" ON "public"."supplierQuote";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier quotes" ON "public"."supplierQuote";
DROP POLICY IF EXISTS "Requests with an API key can access supplier quotes" ON "public"."supplierQuote";

CREATE POLICY "SELECT" ON "public"."supplierQuote"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierQuote"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierQuote"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierQuote"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierQuoteFavorite (user-scoped, no companyId)

DROP POLICY IF EXISTS "Users can view their own supplier quote favorites" ON "public"."supplierQuoteFavorite";
DROP POLICY IF EXISTS "Users can create their own supplier quote favorites" ON "public"."supplierQuoteFavorite";
DROP POLICY IF EXISTS "Users can delete their own supplier quote favorites" ON "public"."supplierQuoteFavorite";

CREATE POLICY "SELECT" ON "public"."supplierQuoteFavorite"
FOR SELECT USING ((SELECT auth.uid())::text = "userId");

CREATE POLICY "INSERT" ON "public"."supplierQuoteFavorite"
FOR INSERT WITH CHECK ((SELECT auth.uid())::text = "userId");

CREATE POLICY "DELETE" ON "public"."supplierQuoteFavorite"
FOR DELETE USING ((SELECT auth.uid())::text = "userId");

-- supplierQuoteLine

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier quote lines" ON "public"."supplierQuoteLine";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier quote lines" ON "public"."supplierQuoteLine";
DROP POLICY IF EXISTS "Suppliers with purchasing_create can create lines on their own supplier quote" ON "public"."supplierQuoteLine";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier quote lines" ON "public"."supplierQuoteLine";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier quote lines" ON "public"."supplierQuoteLine";
DROP POLICY IF EXISTS "Requests with an API key can access supplier quotes" ON "public"."supplierQuoteLine";

CREATE POLICY "SELECT" ON "public"."supplierQuoteLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierQuoteLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierQuoteLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierQuoteLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierQuoteLinePrice (FK via supplierQuoteId -> supplierQuote)

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier quote line pricing" ON "public"."supplierQuoteLinePrice";
DROP POLICY IF EXISTS "Suppliers with purchasing_view can view their own quote line pricing" ON "public"."supplierQuoteLinePrice";
DROP POLICY IF EXISTS "Employees with purchasing_create can insert supplier quote line pricing" ON "public"."supplierQuoteLinePrice";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier quote line pricing" ON "public"."supplierQuoteLinePrice";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier quote line pricing" ON "public"."supplierQuoteLinePrice";
DROP POLICY IF EXISTS "Requests with an API key can access supplier quote line pricing" ON "public"."supplierQuoteLinePrice";

CREATE POLICY "SELECT" ON "public"."supplierQuoteLinePrice"
FOR SELECT USING (
  get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierQuoteLinePrice"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierQuoteLinePrice"
FOR UPDATE USING (
  get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierQuoteLinePrice"
FOR DELETE USING (
  get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote') = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierShipping (SELECT + UPDATE only)

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier shipping" ON "public"."supplierShipping";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier shipping" ON "public"."supplierShipping";
DROP POLICY IF EXISTS "Requests with an API key can access supplier shipping" ON "public"."supplierShipping";

CREATE POLICY "SELECT" ON "public"."supplierShipping"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierShipping"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

-- supplierStatus (any_role for SELECT)

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier statuses" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier statuses" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier statuses" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier statuses" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Requests with an API key can access supplier statuses" ON "public"."supplierStatus";

CREATE POLICY "SELECT" ON "public"."supplierStatus"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_any_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierStatus"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierStatus"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierStatus"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- supplierType (any_role for SELECT)

DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier types" ON "public"."supplierType";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier types" ON "public"."supplierType";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier types" ON "public"."supplierType";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier types" ON "public"."supplierType";
DROP POLICY IF EXISTS "Requests with an API key can access supplier types" ON "public"."supplierType";

CREATE POLICY "SELECT" ON "public"."supplierType"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_any_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplierType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierType"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierType"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_delete'))::text[]
  )
);

-- ============================================================================
-- Batch 10: Shipping & Misc
-- ============================================================================

-- membership (FK via groupId -> group)

DROP POLICY IF EXISTS "All employees can view memberships" ON "public"."membership";
DROP POLICY IF EXISTS "Employees with users_update can create memberships" ON "public"."membership";
DROP POLICY IF EXISTS "Employees with users_update can update memberships" ON "public"."membership";
DROP POLICY IF EXISTS "Employees with users_update can delete memberships" ON "public"."membership";
DROP POLICY IF EXISTS "Requests with an API key can access memberships" ON "public"."membership";

CREATE POLICY "SELECT" ON "public"."membership"
FOR SELECT USING (
  get_company_id_from_foreign_key("groupId", 'group') = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."membership"
FOR INSERT WITH CHECK (
  get_company_id_from_foreign_key("groupId", 'group') = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."membership"
FOR UPDATE USING (
  get_company_id_from_foreign_key("groupId", 'group') = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."membership"
FOR DELETE USING (
  get_company_id_from_foreign_key("groupId", 'group') = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

-- note (user-scoped UPDATE/DELETE)

DROP POLICY IF EXISTS "Employees can view notes" ON "public"."note";
DROP POLICY IF EXISTS "Employees can insert notes" ON "public"."note";
DROP POLICY IF EXISTS "Employees can update their own notes" ON "public"."note";
DROP POLICY IF EXISTS "Employees can delete their own notes" ON "public"."note";
DROP POLICY IF EXISTS "Requests with an API key can access notes" ON "public"."note";

CREATE POLICY "SELECT" ON "public"."note"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."note"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."note"
FOR UPDATE USING (
  "createdBy"::uuid = (SELECT auth.uid())
);

CREATE POLICY "DELETE" ON "public"."note"
FOR DELETE USING (
  "createdBy"::uuid = (SELECT auth.uid())
);

-- receipt

DROP POLICY IF EXISTS "Employees with inventory_view can view receipts" ON "public"."receipt";
DROP POLICY IF EXISTS "Employees with inventory_create can insert receipts" ON "public"."receipt";
DROP POLICY IF EXISTS "Employees with inventory_update can update receipts" ON "public"."receipt";
DROP POLICY IF EXISTS "Employees with inventory_delete can delete receipts" ON "public"."receipt";
DROP POLICY IF EXISTS "Requests with an API key can access receipts" ON "public"."receipt";

CREATE POLICY "SELECT" ON "public"."receipt"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."receipt"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."receipt"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."receipt"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

-- receiptLine

DROP POLICY IF EXISTS "Employees with inventory_view can view receipt lines" ON "public"."receiptLine";
DROP POLICY IF EXISTS "Employees with inventory_create can insert receipt lines" ON "public"."receiptLine";
DROP POLICY IF EXISTS "Employees with inventory_update can update receipt lines" ON "public"."receiptLine";
DROP POLICY IF EXISTS "Employees with inventory_delete can delete receipt lines" ON "public"."receiptLine";
DROP POLICY IF EXISTS "Requests with an API key can access receipt lines" ON "public"."receiptLine";

CREATE POLICY "SELECT" ON "public"."receiptLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."receiptLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."receiptLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."receiptLine"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

-- sequence

DROP POLICY IF EXISTS "Employees with settings_view can view sequences" ON "public"."sequence";
DROP POLICY IF EXISTS "Employees with settings_create can create sequences" ON "public"."sequence";
DROP POLICY IF EXISTS "Employees with settings_update can update sequences" ON "public"."sequence";
DROP POLICY IF EXISTS "Employees with settings_delete can delete sequences" ON "public"."sequence";
DROP POLICY IF EXISTS "Requests with an API key can access sequences" ON "public"."sequence";

CREATE POLICY "SELECT" ON "public"."sequence"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."sequence"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."sequence"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."sequence"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);

-- shippingMethod

DROP POLICY IF EXISTS "Certain employees can view shipping methods" ON "public"."shippingMethod";
DROP POLICY IF EXISTS "Employees with inventory_create can insert shipping methods" ON "public"."shippingMethod";
DROP POLICY IF EXISTS "Employees with inventory_update can update shipping methods" ON "public"."shippingMethod";
DROP POLICY IF EXISTS "Employees with inventory_delete can delete shipping methods" ON "public"."shippingMethod";
DROP POLICY IF EXISTS "Requests with an API key can access shipping methods" ON "public"."shippingMethod";

CREATE POLICY "SELECT" ON "public"."shippingMethod"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."shippingMethod"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."shippingMethod"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."shippingMethod"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

-- shippingTerm

DROP POLICY IF EXISTS "Certain employees can view shipping terms" ON "public"."shippingTerm";
DROP POLICY IF EXISTS "Employees with inventory_create can insert shipping terms" ON "public"."shippingTerm";
DROP POLICY IF EXISTS "Employees with inventory_update can update shipping terms" ON "public"."shippingTerm";
DROP POLICY IF EXISTS "Employees with inventory_delete can delete shipping terms" ON "public"."shippingTerm";
DROP POLICY IF EXISTS "Requests with an API key can access shipping terms" ON "public"."shippingTerm";

CREATE POLICY "SELECT" ON "public"."shippingTerm"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."shippingTerm"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."shippingTerm"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."shippingTerm"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

-- tag

DROP POLICY IF EXISTS "Users can view tags in their company" ON "public"."tag";
DROP POLICY IF EXISTS "Users can insert tags in their company" ON "public"."tag";
DROP POLICY IF EXISTS "Users can delete tags in their company" ON "public"."tag";
DROP POLICY IF EXISTS "Requests with an API key can access tags" ON "public"."tag";

CREATE POLICY "SELECT" ON "public"."tag"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."tag"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."tag"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

-- ============================================================================
-- Batch 11: User-based favorites
-- ============================================================================

-- jobFavorite (user-scoped, no companyId)

DROP POLICY IF EXISTS "Users can view their own job favorites" ON "public"."jobFavorite";
DROP POLICY IF EXISTS "Users can create their own job favorites" ON "public"."jobFavorite";
DROP POLICY IF EXISTS "Users can delete their own job favorites" ON "public"."jobFavorite";

CREATE POLICY "SELECT" ON "public"."jobFavorite"
FOR SELECT USING ((SELECT auth.uid())::text = "userId");

CREATE POLICY "INSERT" ON "public"."jobFavorite"
FOR INSERT WITH CHECK ((SELECT auth.uid())::text = "userId");

CREATE POLICY "DELETE" ON "public"."jobFavorite"
FOR DELETE USING ((SELECT auth.uid())::text = "userId");

-- purchasingRfqFavorite (user-scoped, no companyId)

DROP POLICY IF EXISTS "Users can view their own purchasingRfq favorites" ON "public"."purchasingRfqFavorite";
DROP POLICY IF EXISTS "Users can create their own purchasingRfq favorites" ON "public"."purchasingRfqFavorite";
DROP POLICY IF EXISTS "Users can delete their own purchasingRfq favorites" ON "public"."purchasingRfqFavorite";

CREATE POLICY "SELECT" ON "public"."purchasingRfqFavorite"
FOR SELECT USING ((SELECT auth.uid())::text = "userId");

CREATE POLICY "INSERT" ON "public"."purchasingRfqFavorite"
FOR INSERT WITH CHECK ((SELECT auth.uid())::text = "userId");

CREATE POLICY "DELETE" ON "public"."purchasingRfqFavorite"
FOR DELETE USING ((SELECT auth.uid())::text = "userId");

-- ============================================================================
-- Batch 12: Missed Tables - Standard companyId
-- ============================================================================



-- jobOperationDependency (SELECT only)

DROP POLICY IF EXISTS "Employees can view job operation dependencies" ON "public"."jobOperationDependency";

CREATE POLICY "SELECT" ON "public"."jobOperationDependency"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- jobOperationNote

DROP POLICY IF EXISTS "Employees can view job operation notes" ON "public"."jobOperationNote";
DROP POLICY IF EXISTS "Employees can insert job operation notes" ON "public"."jobOperationNote";
DROP POLICY IF EXISTS "Employees with production_update can update job operation notes" ON "public"."jobOperationNote";
DROP POLICY IF EXISTS "Employees with production_delete can delete job operation notes" ON "public"."jobOperationNote";

CREATE POLICY "SELECT" ON "public"."jobOperationNote"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperationNote"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperationNote"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperationNote"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_delete'))::text[]
  )
);

-- material

DROP POLICY IF EXISTS "Employees can view materials" ON "public"."material";
DROP POLICY IF EXISTS "Employees with parts_create can insert materials" ON "public"."material";
DROP POLICY IF EXISTS "Employees with parts_update can update materials" ON "public"."material";
DROP POLICY IF EXISTS "Employees with parts_delete can delete materials" ON "public"."material";
DROP POLICY IF EXISTS "Requests with an API key can access materials" ON "public"."material";

CREATE POLICY "SELECT" ON "public"."material"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."material"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."material"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."material"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);


-- tool

DROP POLICY IF EXISTS "Employees can view tools" ON "public"."tool";
DROP POLICY IF EXISTS "Employees with parts_create can insert tools" ON "public"."tool";
DROP POLICY IF EXISTS "Employees with parts_update can update tools" ON "public"."tool";
DROP POLICY IF EXISTS "Employees with parts_delete can delete tools" ON "public"."tool";
DROP POLICY IF EXISTS "Requests with an API key can access tools" ON "public"."tool";

CREATE POLICY "SELECT" ON "public"."tool"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."tool"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."tool"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."tool"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- userToCompany

DROP POLICY IF EXISTS "Authenticated users can view userToCompany" ON "public"."userToCompany";
DROP POLICY IF EXISTS "Employees with users_create can create userToCompany" ON "public"."userToCompany";
DROP POLICY IF EXISTS "Employees with users_update can update userToCompany" ON "public"."userToCompany";
DROP POLICY IF EXISTS "Employees with users_delete can delete userToCompany" ON "public"."userToCompany";

CREATE POLICY "SELECT" ON "public"."userToCompany"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."userToCompany"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."userToCompany"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."userToCompany"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('users_delete'))::text[]
  )
);

-- ============================================================================
-- Batch 13: Multi-permission SELECT tables
-- ============================================================================

-- supplierPart (renamed from buyMethod)

DROP POLICY IF EXISTS "Employees with part/purchasing_view can view part suppliers" ON "public"."supplierPart";
DROP POLICY IF EXISTS "Employees with parts_create can create part suppliers" ON "public"."supplierPart";
DROP POLICY IF EXISTS "Employees with parts_update can update part suppliers" ON "public"."supplierPart";
DROP POLICY IF EXISTS "Employees with parts_delete can delete part suppliers" ON "public"."supplierPart";
DROP POLICY IF EXISTS "Suppliers with parts_view can view their own part suppliers" ON "public"."supplierPart";
DROP POLICY IF EXISTS "Suppliers with parts_update can update their own part suppliers" ON "public"."supplierPart";
DROP POLICY IF EXISTS "Requests with an API key can access buy methods" ON "public"."supplierPart";

CREATE POLICY "SELECT" ON "public"."supplierPart"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('parts_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."supplierPart"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierPart"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierPart"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_delete'))::text[]
  )
);

-- supplierProcess (multi-permission SELECT + INSERT + DELETE)

DROP POLICY IF EXISTS "Employees with purchasing, resources, or sales can read supplier processes" ON "public"."supplierProcess";
DROP POLICY IF EXISTS "Employees with resources and purchasing can create supplier processes" ON "public"."supplierProcess";
DROP POLICY IF EXISTS "Employees with resources can update supplier processes" ON "public"."supplierProcess";
DROP POLICY IF EXISTS "Employees with resources or purchasing can delete supplier processes" ON "public"."supplierProcess";
DROP POLICY IF EXISTS "Requests with an API key can access supplier processes" ON "public"."supplierProcess";

CREATE POLICY "SELECT" ON "public"."supplierProcess"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('resources_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
    ))
  )
);

CREATE POLICY "INSERT" ON "public"."supplierProcess"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('purchasing_update'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('resources_update'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierProcess"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('resources_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplierProcess"
FOR DELETE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('purchasing_delete'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('resources_delete'))
    ))
  )
);

-- ============================================================================
-- Batch 14: Special ID pattern + FK lookup
-- ============================================================================

-- terms (id = companyId, SELECT + UPDATE only)

DROP POLICY IF EXISTS "Employees with purchasing_view or sales_view or settings_view can view terms" ON "public"."terms";
DROP POLICY IF EXISTS "Employees with settings_update can update terms" ON "public"."terms";

CREATE POLICY "SELECT" ON "public"."terms"
FOR SELECT USING (
  "id" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('purchasing_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('sales_view'))
      UNION
      SELECT unnest(get_companies_with_employee_permission('settings_view'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."terms"
FOR UPDATE USING (
  "id" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

-- ============================================================================
-- Batch 15: Clean up old policies on tables that already have new-style policies
-- ============================================================================

-- jobOperationTool (new-style policies already exist from 20250207105852_tools-rls.sql)

DROP POLICY IF EXISTS "Employees can view job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Employees with production_create can create job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Employees with production_delete can delete job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Employees with production_update can update job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Employees with production_view can view job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Requests with an API key can access job operation tools" ON "public"."jobOperationTool";

-- methodOperationTool (new-style policies already exist from 20250207105852_tools-rls.sql)

DROP POLICY IF EXISTS "Employees with parts_create can create method operation tools" ON "public"."methodOperationTool";
DROP POLICY IF EXISTS "Employees with parts_delete can delete method operation tools" ON "public"."methodOperationTool";
DROP POLICY IF EXISTS "Employees with parts_update can update method operation tools" ON "public"."methodOperationTool";
DROP POLICY IF EXISTS "Employees with parts_view can view method operation tools" ON "public"."methodOperationTool";
DROP POLICY IF EXISTS "Requests with an API key can access method operation tools" ON "public"."methodOperationTool";

-- quoteOperationTool (new-style policies already exist from 20250207105852_tools-rls.sql)

DROP POLICY IF EXISTS "Employees with sales_create can create quote operation tools" ON "public"."quoteOperationTool";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote operation tools" ON "public"."quoteOperationTool";
DROP POLICY IF EXISTS "Employees with sales_update can update quote operation tools" ON "public"."quoteOperationTool";
DROP POLICY IF EXISTS "Employees with sales_view can view quote operation tools" ON "public"."quoteOperationTool";
DROP POLICY IF EXISTS "Requests with an API key can access quote operation tools" ON "public"."quoteOperationTool";

-- materialForm (new-style policies already exist from 20250827201650_radan-v1.sql)

DROP POLICY IF EXISTS "Authenticated users can view global material forms" ON "public"."materialForm";
DROP POLICY IF EXISTS "Employees can view material forms" ON "public"."materialForm";
DROP POLICY IF EXISTS "Employees with parts_create can insert material forms" ON "public"."materialForm";
DROP POLICY IF EXISTS "Employees with parts_update can update material forms" ON "public"."materialForm";
DROP POLICY IF EXISTS "Employees with parts_delete can delete material forms" ON "public"."materialForm";
DROP POLICY IF EXISTS "Requests with an API key can access material forms" ON "public"."materialForm";

-- materialSubstance (new-style policies already exist from 20250827201650_radan-v1.sql)

DROP POLICY IF EXISTS "Authenticated users can view global material substances" ON "public"."materialSubstance";
DROP POLICY IF EXISTS "Employees can view material substances" ON "public"."materialSubstance";
DROP POLICY IF EXISTS "Employees with parts_create can insert material substances" ON "public"."materialSubstance";
DROP POLICY IF EXISTS "Employees with parts_update can update material substances" ON "public"."materialSubstance";
DROP POLICY IF EXISTS "Employees with parts_delete can delete material substances" ON "public"."materialSubstance";
DROP POLICY IF EXISTS "Requests with an API key can access material substances" ON "public"."materialSubstance";

-- ============================================================================
-- Batch 16: Drop leftover old policies on already-refactored tables
-- ============================================================================

-- companyIntegration (old UPDATE policy duplicates new "UPDATE" from rls-refactor.sql)

DROP POLICY IF EXISTS "Employees with settings_update can update company integrations." ON "public"."companyIntegration";

-- documentTransaction (old policies duplicate new-style from 20250707 migration)

DROP POLICY IF EXISTS "Users can insert document transactions" ON "public"."documentTransaction";
DROP POLICY IF EXISTS "Users with documents_view can see document transactions" ON "public"."documentTransaction";

-- salesOrderPayment (old policies + API key policy)

DROP POLICY IF EXISTS "Employees with sales_view can view sales order payments" ON "public"."salesOrderPayment";
DROP POLICY IF EXISTS "Employees with sales_create can create sales order payments" ON "public"."salesOrderPayment";
DROP POLICY IF EXISTS "Employees with sales_update can update sales order payments" ON "public"."salesOrderPayment";
DROP POLICY IF EXISTS "Employees with sales_delete can delete sales order payments" ON "public"."salesOrderPayment";
DROP POLICY IF EXISTS "Requests with an API key can access requests for sales order payments" ON "public"."salesOrderPayment";

-- ============================================================================
-- Batch 17: Fix auth.() -> (select auth.()) performance issues
-- ============================================================================

-- user: fix "Users can modify themselves"

DROP POLICY IF EXISTS "Users can modify themselves" ON "public"."user";

CREATE POLICY "Users can modify themselves" ON "public"."user"
FOR UPDATE WITH CHECK ((SELECT auth.uid())::text = "id");

-- user: fix "Users can view other users from their same company"

DROP POLICY IF EXISTS "Users can view other users from their same company" ON "public"."user";

CREATE POLICY "Users can view other users from their same company" ON "public"."user"
FOR SELECT USING (
  "id" = (SELECT auth.uid())::text OR
  "id" IN (
    SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid())::text
    )
  )
);

-- userPermission: fix "Users with users_update can view permissions of other users in their company"

DROP POLICY IF EXISTS "Users with users_update can view permissions of other users in their company" ON "public"."userPermission";

CREATE POLICY "Users with users_update can view permissions of other users in their company" ON "public"."userPermission"
FOR SELECT USING (
  "id" IN (
    SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid())::text
    )
  )
);

-- attributeDataType: fix auth.role()

DROP POLICY IF EXISTS "Authenticated users can view attribute data types" ON "public"."attributeDataType";

CREATE POLICY "Authenticated users can view attribute data types" ON "public"."attributeDataType"
FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

-- config: fix auth.role()

DROP POLICY IF EXISTS "SELECT" ON "public"."config";

CREATE POLICY "SELECT" ON "public"."config"
FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

-- webhookTable: fix auth.role()

DROP POLICY IF EXISTS "SELECT" ON "public"."webhookTable";

CREATE POLICY "SELECT" ON "public"."webhookTable"
FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

-- companyUsage: fix auth.role() and auth.uid()

DROP POLICY IF EXISTS "SELECT" ON "public"."companyUsage";

CREATE POLICY "SELECT" ON "public"."companyUsage"
FOR SELECT USING (
  (SELECT auth.role()) = 'authenticated' AND "id" IN (
    SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid())::text
  )
);

-- plan: fix auth.role()

DROP POLICY IF EXISTS "SELECT" ON "public"."plan";

CREATE POLICY "SELECT" ON "public"."plan"
FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

-- companyPlan: fix auth.role() and auth.uid()

DROP POLICY IF EXISTS "SELECT" ON "public"."companyPlan";

CREATE POLICY "SELECT" ON "public"."companyPlan"
FOR SELECT USING (
  (SELECT auth.role()) = 'authenticated' AND "id" IN (
    SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid())::text
  )
);

-- lessonCompletion: fix auth.uid()

DROP POLICY IF EXISTS "SELECT" ON "public"."lessonCompletion";
DROP POLICY IF EXISTS "INSERT" ON "public"."lessonCompletion";

CREATE POLICY "SELECT" ON "public"."lessonCompletion"
FOR SELECT USING ((SELECT auth.uid())::text = "userId");

CREATE POLICY "INSERT" ON "public"."lessonCompletion"
FOR INSERT WITH CHECK ((SELECT auth.uid())::text = "userId");

-- challengeAttempt: fix auth.uid()

DROP POLICY IF EXISTS "SELECT" ON "public"."challengeAttempt";
DROP POLICY IF EXISTS "INSERT" ON "public"."challengeAttempt";

CREATE POLICY "SELECT" ON "public"."challengeAttempt"
FOR SELECT USING ((SELECT auth.uid())::text = "userId");

CREATE POLICY "INSERT" ON "public"."challengeAttempt"
FOR INSERT WITH CHECK ((SELECT auth.uid())::text = "userId");

-- trainingCompletion: fix auth.uid() in INSERT

DROP POLICY IF EXISTS "INSERT" ON "public"."trainingCompletion";

CREATE POLICY "INSERT" ON "public"."trainingCompletion"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('people_create'))::text[]
  ) OR (
    (SELECT auth.uid())::text = "employeeId"
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  )
);

-- maintenanceDispatchComment: fix auth.uid()

DROP POLICY IF EXISTS "UPDATE" ON "public"."maintenanceDispatchComment";
DROP POLICY IF EXISTS "DELETE" ON "public"."maintenanceDispatchComment";

CREATE POLICY "UPDATE" ON "public"."maintenanceDispatchComment"
FOR UPDATE USING (
  "createdBy" = (SELECT auth.uid())::text
);

CREATE POLICY "DELETE" ON "public"."maintenanceDispatchComment"
FOR DELETE USING (
  "createdBy" = (SELECT auth.uid())::text
);

-- eventSystemSubscription: fix auth.role()

DROP POLICY IF EXISTS "manage_subscriptions" ON "public"."eventSystemSubscription";

CREATE POLICY "manage_subscriptions" ON "public"."eventSystemSubscription"
FOR ALL USING ((SELECT auth.role()) = 'authenticated');

-- approvalRule: fix duplicate policies (UPDATE and DELETE use USING instead of proper FOR syntax)

DROP POLICY IF EXISTS "SELECT" ON "public"."approvalRule";
DROP POLICY IF EXISTS "INSERT" ON "public"."approvalRule";
DROP POLICY IF EXISTS "UPDATE" ON "public"."approvalRule";
DROP POLICY IF EXISTS "DELETE" ON "public"."approvalRule";

CREATE POLICY "SELECT" ON "public"."approvalRule"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."approvalRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."approvalRule"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."approvalRule"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);
