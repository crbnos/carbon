ALTER TYPE "module" ADD VALUE 'People' AFTER 'Resources';



DROP POLICY "Employees with resources_create can insert employee jobs" ON "employeeJob";
CREATE POLICY "Employees with people_create can insert employee jobs" ON "employeeJob"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('people_create', "companyId")
);

DROP POLICY "Employees with resources_update can update employee jobs" ON "employeeJob";
CREATE POLICY "Employees with people_update can update employee jobs" ON "employeeJob"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('people_update', "companyId")
  );

DROP POLICY "Employees with resources_delete can delete employee jobs" ON "employeeJob";
CREATE POLICY "Employees with people_delete can delete employee jobs" ON "employeeJob"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('people_delete', "companyId")
  );

DROP POLICY "Employees can view employee shifts" ON "employeeShift";
CREATE POLICY "Employees with people_view can view employee shifts" ON "employeeShift"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('people_view', get_company_id_from_foreign_key("employeeId", 'employee'))
  );

DROP POLICY "Employees with resources_create can insert employee shifts" ON "employeeShift";
CREATE POLICY "Employees with people_create can insert employee shifts" ON "employeeShift"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('people_create', get_company_id_from_foreign_key("employeeId", 'employee'))
);

DROP POLICY "Employees with resources_update can update employee shifts" ON "employeeShift";
CREATE POLICY "Employees with people_update can update employee shifts" ON "employeeShift"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('people_update', get_company_id_from_foreign_key("employeeId", 'employee'))
  );

DROP POLICY "Employees with resources_delete can delete employee shifts" ON "employeeShift";
CREATE POLICY "Employees with people_delete can delete employee shifts" ON "employeeShift"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("employeeId", 'employee')) AND
    has_company_permission('people_delete', get_company_id_from_foreign_key("employeeId", 'employee'))
  );


DROP POLICY "Users can view other users attributes if the category is public" ON "userAttributeValue";


DROP POLICY "Employees with resources_create can insert departments" ON "department";
CREATE POLICY "Employees with people_create can insert departments" ON "department"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('people_create', "companyId")
);

DROP POLICY "Employees with resources_update can update departments" ON "department";
CREATE POLICY "Employees with people_update can update departments" ON "department"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('people_update', "companyId")
  );

DROP POLICY "Employees with resources_delete can delete departments" ON "department";
CREATE POLICY "Employees with people_delete can delete departments" ON "department"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('people_delete', "companyId")
  );

DROP POLICY "Employees with resources_create can insert shifts" ON "shift";
CREATE POLICY "Employees with people_create can insert shifts" ON "shift"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('people_create', "companyId")
);

DROP POLICY "Employees with resources_update can update shifts" ON "shift";
CREATE POLICY "Employees with people_update can update shifts" ON "shift"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('people_update', "companyId")
  );

DROP POLICY "Employees with resources_delete can delete shifts" ON "shift";
CREATE POLICY "Employees with people_delete can delete shifts" ON "shift"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('people_delete', "companyId")
  );


DROP POLICY "Employees with resources_create can insert holidays" ON "holiday";
CREATE POLICY "Employees with people_create can insert holidays" ON "holiday"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('people_create', "companyId")
);

DROP POLICY "Employees with resources_update can update holidays" ON "holiday";
CREATE POLICY "Employees with people_update can update holidays" ON "holiday"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('people_update', "companyId")
  );

DROP POLICY "Employees with resources_delete can delete holidays" ON "holiday";
CREATE POLICY "Employees with people_delete can delete holidays" ON "holiday"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('people_delete', "companyId")
  );
