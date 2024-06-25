CREATE TABLE "group" (
  "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
  "name" TEXT NOT NULL,
  "companyId" TEXT,
  "isIdentityGroup" BOOLEAN NOT NULL DEFAULT false,
  "isEmployeeTypeGroup" BOOLEAN NOT NULL DEFAULT false,
  "isCustomerOrgGroup" BOOLEAN NOT NULL DEFAULT false,
  "isCustomerTypeGroup" BOOLEAN NOT NULL DEFAULT false,
  "isSupplierTypeGroup" BOOLEAN NOT NULL DEFAULT false,
  "isSupplierOrgGroup" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT "group_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "group_companyId_idx" ON "group" ("companyId");

CREATE TABLE "membership" (
  "id" SERIAL NOT NULL,
  "groupId" TEXT NOT NULL,
  "memberGroupId" TEXT,
  "memberUserId" TEXT,

  CONSTRAINT "membership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "membership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_memberGroupId_fkey" FOREIGN KEY ("memberGroupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_memberUserId_fkey" FOREIGN KEY ("memberUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  
  CONSTRAINT uq_membership
    UNIQUE ( "groupId", "memberGroupId", "memberUserId" ),
  
  CONSTRAINT membership_hasPersonOrGroup
    CHECK (
      ("memberGroupId" IS NULL AND "memberUserId" IS NOT NULL) 
      OR 
      ("memberGroupId" IS NOT NULL AND "memberUserId" IS NULL)
    )
);

CREATE INDEX index_membership_groupId ON "membership" ("groupId");
CREATE INDEX index_membership_memberGroupId ON "membership" ("memberGroupId");
CREATE INDEX index_membership_memberUserId ON "membership" ("memberUserId");

ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All employees can view memberships" ON "membership" FOR SELECT USING (
  has_role('employee', get_company_id_from_foreign_key("groupId", 'group'))
);

CREATE POLICY "Employees with users_update can create memberships" ON "membership" FOR INSERT WITH CHECK (
  has_role('employee', get_company_id_from_foreign_key("groupId", 'group')) AND
  has_company_permission('users_update', get_company_id_from_foreign_key("groupId", 'group'))
);

CREATE POLICY "Employees with users_update can update memberships" ON "membership" FOR UPDATE USING (
  has_role('employee', get_company_id_from_foreign_key("groupId", 'group')) AND
  has_company_permission('users_update', get_company_id_from_foreign_key("groupId", 'group'))
);

CREATE POLICY "Employees with users_update can delete memberships" ON "membership" FOR DELETE USING (
  has_role('employee', get_company_id_from_foreign_key("groupId", 'group')) AND
  has_company_permission('users_update', get_company_id_from_foreign_key("groupId", 'group'))
);


CREATE FUNCTION public.create_employee_type_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."group" ("id", "name", "isEmployeeTypeGroup", "companyId")
  VALUES (new.id, new.name, TRUE, new."companyId");

  INSERT INTO public."membership"("groupId", "memberGroupId")
  VALUES ('00000000-0000-' || substring(new."companyId"::text, 1, 4) || '-' || substring(new."companyId"::text, 5, 4) || '-' || substring(new."companyId"::text, 9, 12), new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;



CREATE FUNCTION public.update_employee_type_group()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public."group" SET "name" = new.name
  WHERE "id" = new.id AND "isEmployeeTypeGroup" = TRUE;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.create_user_identity_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."group" ("id", "name", "isIdentityGroup")
  VALUES (new.id, new."fullName", TRUE);

  INSERT INTO public."membership"("groupId", "memberUserId")
  VALUES (new.id, new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.update_user_identity_group()
RETURNS TRIGGER AS $$
BEGIN
  update public."group" set "name" = new."fullName"
  where "id" = new.id and "isIdentityGroup" = TRUE;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE FUNCTION public.add_employee_to_employee_type_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."membership" ("groupId", "memberUserId")
  VALUES (new."employeeTypeId", new.id);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.update_employee_to_employee_type_group()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public."membership" SET "groupId" = new."employeeTypeId"
  WHERE "groupId" = old."employeeTypeId" AND "memberUserId" = new.id;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_employee_type_group
  AFTER INSERT on public."employeeType"
  FOR EACH ROW EXECUTE PROCEDURE public.create_employee_type_group();

CREATE TRIGGER create_user_identity_group
  AFTER INSERT on public.user
  FOR EACH ROW EXECUTE PROCEDURE public.create_user_identity_group();    

CREATE TRIGGER add_employee_to_employee_type_group
  AFTER INSERT on public.employee
  FOR EACH ROW EXECUTE PROCEDURE public.add_employee_to_employee_type_group();

CREATE TRIGGER update_user_identity_group
  AFTER UPDATE on public.user
  FOR EACH ROW EXECUTE PROCEDURE public.update_user_identity_group();

CREATE TRIGGER update_employee_to_employee_type_group
  AFTER UPDATE on public.employee
  FOR EACH ROW EXECUTE PROCEDURE public.update_employee_to_employee_type_group();

CREATE TRIGGER update_employee_type_group
  AFTER UPDATE on public."employeeType"
  FOR EACH ROW EXECUTE PROCEDURE public.update_employee_type_group();

CREATE OR REPLACE VIEW "groupMembers" AS 
  SELECT
    gm.id,
    g.name,
    g."companyId",
    g."isIdentityGroup",
    g."isEmployeeTypeGroup",
    g."isCustomerOrgGroup",
    g."isCustomerTypeGroup",
    g."isSupplierOrgGroup",
    g."isSupplierTypeGroup",
    gm."groupId",
    gm."memberGroupId",
    gm."memberUserId",
    to_jsonb(u) as user
  FROM 
    "membership" gm 
    INNER JOIN "group" g ON g.id = gm."groupId"
    LEFT OUTER JOIN (
      SELECT * FROM "user" WHERE active = TRUE
    ) u ON u.id = gm."memberUserId";
  

CREATE RECURSIVE VIEW groups_recursive 
(
  "groupId", 
  "name",
  "companyId",
  "parentId",
  "isIdentityGroup",
  "isEmployeeTypeGroup",
  "isCustomerOrgGroup",
  "isCustomerTypeGroup",
  "isSupplierOrgGroup",
  "isSupplierTypeGroup",
  "user"
) AS 
  SELECT 
    "groupId", 
    "name",
    "companyId", 
    NULL AS "parentId", 
    "isIdentityGroup", 
    "isEmployeeTypeGroup",
    "isCustomerOrgGroup",
    "isCustomerTypeGroup",
    "isSupplierOrgGroup",
    "isSupplierTypeGroup",
    "user"
  FROM "groupMembers"
  UNION ALL 
  SELECT 
    g2."groupId", 
    g2.name, 
    g2."companyId",
    g1."groupId" AS "parentId", 
    g1."isIdentityGroup", 
    g2."isEmployeeTypeGroup",  
    g2."isCustomerOrgGroup",
    g2."isCustomerTypeGroup",
    g2."isSupplierOrgGroup",
    g2."isSupplierTypeGroup",
    g2."user"
  FROM "groupMembers" g1 
  INNER JOIN "groupMembers" g2 ON g1."memberGroupId" = g2."groupId";

CREATE OR REPLACE VIEW "groups" AS
  SELECT 
    "groupId" as "id", 
    "isEmployeeTypeGroup",
    "isCustomerOrgGroup",
    "isCustomerTypeGroup",
    "isSupplierOrgGroup",
    "isSupplierTypeGroup",
    "name", 
    "companyId",
    "parentId", 
    coalesce(jsonb_agg("user") filter (where "user" is not null), '[]') as users
  FROM groups_recursive 
  WHERE "isIdentityGroup" = false
  GROUP BY 
    "groupId", 
    "name", 
    "companyId",
    "parentId", 
    "isEmployeeTypeGroup", 
    "isCustomerOrgGroup",
    "isCustomerTypeGroup",
    "isSupplierOrgGroup",
    "isSupplierTypeGroup"
  ORDER BY "isEmployeeTypeGroup" DESC, "isCustomerTypeGroup" DESC, "isSupplierTypeGroup" DESC, "name" ASC;


CREATE OR REPLACE FUNCTION groups_query(
  _name TEXT DEFAULT '',
  _uid TEXT DEFAULT NULL
) 
RETURNS TABLE (
  "id" TEXT,
  "name" TEXT,
  "companyId" TEXT,
  "parentId" TEXT,
  "isEmployeeTypeGroup" BOOLEAN,
  "isCustomerOrgGroup" BOOLEAN,
  "isCustomerTypeGroup" BOOLEAN,
  "isSupplierOrgGroup" BOOLEAN,
  "isSupplierTypeGroup" BOOLEAN,
  "users" JSONB
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
  BEGIN
    RETURN QUERY
      WITH group_ids AS (
        SELECT g."id" 
        FROM "group" g
        WHERE g."isIdentityGroup" = false
          AND g."name" ILIKE '%' || _name || '%'          
      )
      SELECT 
      g."id",
      g."name",
      g."companyId",
      g."parentId",
      g."isEmployeeTypeGroup",
      g."isCustomerOrgGroup",
      g."isCustomerTypeGroup",
      g."isSupplierOrgGroup",
      g."isSupplierTypeGroup",
      g."users"
      FROM groups g
      WHERE g."id" IN (SELECT * FROM group_ids)
        OR g."parentId" IN (SELECT * FROM group_ids);
  END;
$$;

CREATE OR REPLACE FUNCTION groups_for_user(uid text) RETURNS TEXT[]
  LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE retval TEXT[];
  BEGIN    
    WITH RECURSIVE "groupsForUser" AS (
    SELECT "groupId", "memberGroupId", "memberUserId" FROM "membership"
    WHERE "memberUserId" = uid::text
    UNION
      SELECT g1."groupId", g1."memberGroupId", g1."memberUserId" FROM "membership" g1
      INNER JOIN "groupsForUser" g2 ON g2."groupId" = g1."memberGroupId"
    ) SELECT array_agg("groupId") INTO retval AS groups FROM "groupsForUser";
    
    RETURN retval;
  END;
$$;

CREATE OR REPLACE FUNCTION users_for_groups(groups text[]) RETURNS "jsonb"
  LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE retval jsonb;
  BEGIN    
    WITH RECURSIVE "usersForGroups" AS (
    SELECT "groupId", "memberGroupId", "memberUserId" FROM "membership"
    WHERE "groupId" = ANY(groups)
    UNION
      SELECT g1."groupId", g1."memberGroupId", g1."memberUserId" FROM "membership" g1
      INNER JOIN "usersForGroups" g2 ON g2."memberGroupId" = g1."groupId"
    ) SELECT coalesce(jsonb_agg("memberUserId"), '[]') AS groups INTO retval FROM "usersForGroups" WHERE "memberUserId" IS NOT NULL;
    RETURN retval;
  END;
$$;

CREATE FUNCTION public.create_customer_type_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."group" ("id", "name", "isCustomerTypeGroup", "companyId")
  VALUES (new.id, new.name, TRUE, new."companyId");

  INSERT INTO public."membership"("groupId", "memberGroupId")
  VALUES ('11111111-1111-' || substring(new."companyId"::text, 1, 4) || '-' || substring(new."companyId"::text, 5, 4) || '-' || substring(new."companyId"::text, 9, 12), new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.create_supplier_type_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."group" ("id", "name", "isSupplierTypeGroup", "companyId")
  VALUES (new.id, new.name, TRUE, new."companyId");

  INSERT INTO public."membership"("groupId", "memberGroupId")
  VALUES ('22222222-2222-'  || substring(new."companyId"::text, 1, 4) || '-' || substring(new."companyId"::text, 5, 4) || '-' || substring(new."companyId"::text, 9, 12), new.id);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.create_customer_org_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."group" ("id", "name", "isCustomerOrgGroup", "companyId")
  VALUES (new.id, new.name, TRUE, new."companyId");

  IF new."customerTypeId" IS NOT NULL THEN
    INSERT INTO public."membership"("groupId", "memberGroupId")
    VALUES (new."customerTypeId", new.id);
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.create_supplier_org_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."group" ("id", "name", "isSupplierOrgGroup", "companyId")
  VALUES (new.id, new.name, TRUE, new."companyId");

  IF new."supplierTypeId" IS NOT NULL THEN
    INSERT INTO public."membership"("groupId", "memberGroupId")
    VALUES (new."supplierTypeId", new.id);
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.add_customer_account_to_customer_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."membership" ("groupId", "memberUserId")
  VALUES (new."customerId", new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.add_supplier_account_to_supplier_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."membership" ("groupId", "memberUserId")
  VALUES (new."supplierId", new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.update_customer_type_group()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public."group" SET "name" = new.name
  WHERE "id" = new.id AND "isCustomerTypeGroup" = TRUE;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.update_supplier_type_group()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public."group" SET "name" = new.name
  WHERE "id" = new.id AND "isSupplierTypeGroup" = TRUE;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.update_customer_to_customer_type_group()
RETURNS TRIGGER AS $$
BEGIN
  IF old."customerTypeId" IS NOT NULL THEN
    IF new."customerTypeId" IS NOT NULL THEN
      UPDATE public."membership" SET "groupId" = new."customerTypeId"
      WHERE "groupId" = old."customerTypeId" AND "memberGroupId" = new.id;
    ELSE
      DELETE FROM public."membership" WHERE "groupId" = old."customerTypeId" AND "memberGroupId" = new.id;
    END IF;
  ELSE
    IF new."customerTypeId" IS NOT NULL THEN
      INSERT INTO public."membership" ("groupId", "memberGroupId")
      VALUES (new."customerTypeId", new.id);
    END IF;
  END IF;

  UPDATE public."group" SET "name" = new.name
  WHERE "id" = new.id AND "isCustomerOrgGroup" = TRUE;
  RETURN new;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.update_supplier_to_supplier_type_group()
RETURNS TRIGGER AS $$
BEGIN
  IF old."supplierTypeId" IS NOT NULL THEN
    IF new."supplierTypeId" IS NOT NULL THEN
      UPDATE public."membership" SET "groupId" = new."supplierTypeId"
      WHERE "groupId" = old."supplierTypeId" AND "memberGroupId" = new.id;
    ELSE
      DELETE FROM public."membership" WHERE "groupId" = old."supplierTypeId" AND "memberGroupId" = new.id;
    END IF;
  ELSE
    IF new."supplierTypeId" IS NOT NULL THEN
      INSERT INTO public."membership" ("groupId", "memberGroupId")
      VALUES (new."supplierTypeId", new.id);
    END IF;
  END IF;

  UPDATE public."group" SET "name" = new.name
  WHERE "id" = new.id AND "isSupplierOrgGroup" = TRUE;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_customer_type_group
  AFTER INSERT on public."customerType"
  FOR EACH ROW EXECUTE PROCEDURE public.create_customer_type_group();

CREATE TRIGGER create_supplier_type_group
  AFTER INSERT on public."supplierType"
  FOR EACH ROW EXECUTE PROCEDURE public.create_supplier_type_group();

CREATE TRIGGER create_customer_org_group
  AFTER INSERT on public.customer
  FOR EACH ROW EXECUTE PROCEDURE public.create_customer_org_group();

CREATE TRIGGER create_supplier_org_group
  AFTER INSERT on public.supplier
  FOR EACH ROW EXECUTE PROCEDURE public.create_supplier_org_group();

CREATE TRIGGER create_customer_account_group
  AFTER INSERT on public."customerAccount"
  FOR EACH ROW EXECUTE PROCEDURE public.add_customer_account_to_customer_group();

CREATE TRIGGER create_supplier_account_group
  AFTER INSERT on public."supplierAccount"
  FOR EACH ROW EXECUTE PROCEDURE public.add_supplier_account_to_supplier_group();

CREATE TRIGGER create_customer_group
  AFTER UPDATE on public.customer
  FOR EACH ROW EXECUTE PROCEDURE public.update_customer_to_customer_type_group();

CREATE TRIGGER create_supplier_group
  AFTER UPDATE on public.supplier
  FOR EACH ROW EXECUTE PROCEDURE public.update_supplier_to_supplier_type_group();

CREATE TRIGGER update_customer_type_group
  AFTER UPDATE on public."customerType"
  FOR EACH ROW EXECUTE PROCEDURE public.update_customer_type_group();

CREATE TRIGGER update_supplier_type_group
  AFTER UPDATE on public."supplierType"
  FOR EACH ROW EXECUTE PROCEDURE public.update_supplier_type_group();

NOTIFY pgrst, 'reload schema';

