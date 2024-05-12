CREATE TABLE "company" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "taxId" TEXT,
  "logo" TEXT,
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "state" TEXT,
  "postalCode" TEXT,
  "countryCode" TEXT,
  "phone" TEXT,
  "fax" TEXT,
  "email" TEXT,
  "website" TEXT,
  "updatedBy" TEXT,
  
  CONSTRAINT "company_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accountDefault_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

ALTER TABLE "company" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with settings_create can create company" ON "company"
  FOR INSERT
  WITH CHECK (
    has_any_company_permission('settings_create')
  );

CREATE POLICY "Employees with settings_update can update company" ON "company"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('settings_update', "id")
  );

CREATE POLICY "Employees with settings_delete can delete company" ON "company"
  FOR DELETE
  USING (
    has_company_permission('settings_delete', "id")
  );

CREATE TABLE "userToCompany" (
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "userToCompany_pkey" PRIMARY KEY ("userId", "companyId")
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
    has_company_permission('users_create', "companyId")
  );

CREATE POLICY "Employees with users_update can update userToCompany" ON "userToCompany"
  FOR UPDATE
  USING (
    has_company_permission('users_update', "companyId")
  );

CREATE POLICY "Employees with users_delete can delete userToCompany" ON "userToCompany"
  FOR DELETE
  USING (
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
VALUES ('system', 'system@carbon.us.org', 'System', 'Operation');


CREATE TABLE "userPermission" (
    "id" TEXT NOT NULL,
    "permissions" JSONB DEFAULT '{}',

    CONSTRAINT "userPermission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "userPermission_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "userPermission" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own permissions" ON "userPermission" FOR SELECT USING (TRUE);
CREATE POLICY "Users with users_update can view permissions of other users in their company" ON "userPermission" FOR SELECT USING (
    "id" IN (
        SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
            SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
        )
    )
);


