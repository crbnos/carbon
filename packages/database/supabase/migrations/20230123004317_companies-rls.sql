ALTER TABLE "company" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone with settings_create can create company" ON "company"
  FOR INSERT
  WITH CHECK (
    has_any_company_permission('settings_create')
  );

CREATE POLICY "Employees with settings_update can update company" ON "company"
  FOR UPDATE
  USING (
    has_role('employee', "id") AND
    has_company_permission('settings_update', "id")
  );

CREATE POLICY "Employees with settings_delete can delete company" ON "company"
  FOR DELETE
  USING (
    has_role('employee', "id") AND
    has_company_permission('settings_delete', "id")
  );


CREATE POLICY "Authenticated users can view company" ON "company"
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND "id" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
    )
  );

ALTER TABLE "userToCompany" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view userToCompany" ON "userToCompany"
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Employees with users_create can create userToCompany" ON "userToCompany"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('users_create', "companyId")
  );

CREATE POLICY "Employees with users_update can update userToCompany" ON "userToCompany"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('users_update', "companyId")
  );

CREATE POLICY "Employees with users_delete can delete userToCompany" ON "userToCompany"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('users_delete', "companyId")
  );



ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Claims admin can view/modify users" ON "user" FOR ALL USING (has_any_company_permission('users_update'));
CREATE POLICY "Users can modify themselves" ON "user" FOR UPDATE WITH CHECK (auth.uid() = id::uuid);
CREATE POLICY "Users can view other users from their same company" ON "user" FOR SELECT USING (
   "id" IN (
        SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
            SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
        )
   )
);

INSERT INTO "user" ("id", "email", "firstName", "lastName")
VALUES ('system', 'system@carbonos.dev', 'System', 'Operation');


ALTER TABLE "userPermission" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own permissions" ON "userPermission" FOR SELECT USING (TRUE);
CREATE POLICY "Users with users_update can view permissions of other users in their company" ON "userPermission" FOR SELECT USING (
    "id" IN (
        SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
            SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
        )
    )
);


