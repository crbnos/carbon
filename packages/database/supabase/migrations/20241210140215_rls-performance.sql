CREATE OR REPLACE FUNCTION has_role(required_role text, company text) RETURNS "bool"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE
      user_role text;
    BEGIN
      SELECT role INTO user_role FROM public."userToCompany" WHERE "userId" = (SELECT auth.uid()::text) AND "companyId" = company;
      return user_role = required_role;
    END;
$$;

CREATE OR REPLACE FUNCTION has_company_permission(claim text, company text) RETURNS "bool"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE
      permission_value text[];
    BEGIN
      -- TODO: (current_setting('request.jwt.claims', true)::jsonb)->'app_metadata'->claim
      SELECT jsonb_to_text_array(coalesce(permissions->claim, '[]')) INTO permission_value FROM public."userPermission" WHERE id = (SELECT auth.uid()::text);
      IF permission_value IS NULL THEN
        return false;
      ELSIF '0' = ANY(permission_value::text[]) THEN
        return true;
      ELSIF company = ANY(permission_value::text[]) THEN
        return true;
      ELSE
        return false;
      END IF;
    END;
$$;

ALTER POLICY "Authenticated users can view company" ON "company"
  USING (
    (SELECT auth.role()) = 'authenticated' AND "id" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid()::text)
    )
  );


ALTER POLICY "Users can modify themselves" ON "user" USING (auth.uid() = id::uuid);
ALTER POLICY "Users can view other users from their same company" ON "user" USING (
   "id" IN (
        SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
            SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid()::text)
        )
   )
);

DROP POLICY "Users can view their own permissions" ON "userPermission";
ALTER POLICY "Users with users_update can view permissions of other users in their company" ON "userPermission" USING (
    "id" IN (
        SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
            SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid()::text)
        )
    )
);

ALTER POLICY "Employees can view employees from their company" ON "employee" USING (
    "companyId" IN (
        SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid()::text)
    )
);


ALTER POLICY "Users can delete their own avatars" ON storage.objects
USING (
    bucket_id = 'avatars'
    AND (auth.role() = 'authenticated')
    AND storage.filename(name) LIKE concat((SELECT auth.uid()::text), '%')
);

ALTER POLICY "Users can update their own avatars" ON storage.objects
USING (
    bucket_id = 'avatars'
    AND (auth.role() = 'authenticated')
    AND storage.filename(name) LIKE concat((SELECT auth.uid()::text), '%')
);

ALTER POLICY "Users can insert their own avatars" ON storage.objects
WITH CHECK (
    bucket_id = 'avatars'
    AND (auth.role() = 'authenticated')
    AND storage.filename(name) LIKE concat((SELECT auth.uid()::text), '%')
);

ALTER POLICY "Users can insert attributes for themselves" ON "userAttributeValue" WITH CHECK ((SELECT auth.uid()) = "userId"::uuid);
ALTER POLICY "Users can modify attributes for themselves" ON "userAttributeValue" WITH CHECK ((SELECT auth.uid()) = "userId"::uuid);
ALTER POLICY "Users can view their own attributes" ON "userAttributeValue" USING ((SELECT auth.uid()) = "userId"::uuid);




ALTER POLICY "Suppliers with purchasing_view can view contacts from their organization" ON "contact"
  USING (
    has_role('supplier', "companyId")
    AND has_company_permission('sales_view', "companyId")
    AND (
      id IN (
        SELECT "contactId" FROM "customerContact" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_view can view contacts from their organization" ON "contact"
  USING (
    has_role('customer', "companyId")
    AND has_company_permission('sales_view', "companyId")
    AND (
      id IN (
        SELECT "contactId" FROM "customerContact" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );



ALTER POLICY "Suppliers with purchasing_create can create contacts from their organization" ON "contact"
  WITH CHECK (
    has_role('supplier', "companyId") 
    AND has_company_permission('purchasing_create', "companyId")
    AND (
      id IN (
        SELECT "contactId" FROM "supplierContact" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" sa WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_create can create contacts from their organization" ON "contact"
  WITH CHECK (
    has_role('customer', "companyId") 
    AND has_company_permission('sales_create', "companyId")
    AND (
      id IN (
        SELECT "contactId" FROM "customerContact" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );


ALTER POLICY "Suppliers with purchasing_update can update contacts from their organization" ON "contact"
  USING (
    has_role('supplier', "companyId") 
    AND has_company_permission('purchasing_update', "companyId")
    AND (
      id IN (
        SELECT "contactId" FROM "supplierContact" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" sa WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );



ALTER POLICY "Customers with sales_update can update contacts from their organization" ON "contact"
  USING (
    has_role('customer', "companyId") 
    AND has_company_permission('sales_update', "companyId")
    AND (
      id IN (
        SELECT "contactId" FROM "customerContact" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" sa WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );


ALTER POLICY "Suppliers with purchasing_delete can delete contacts from their organization" ON "contact"
  USING (
    has_role('supplier', "companyId") 
    AND has_company_permission('purchasing_delete', "companyId")
    AND (
      id IN (
        SELECT "contactId" FROM "supplierContact" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" sa WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );



ALTER POLICY "Customers with sales_delete can delete contacts from their organization" ON "contact"
  USING (
    has_role('customer', "companyId") 
    AND has_company_permission('sales_delete', "companyId")
    AND (
      id IN (
        SELECT "contactId" FROM "customerContact" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" sa WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );



ALTER POLICY "Customers with sales_view can their own organization" ON "customer"
  USING (
    has_role('customer', "companyId")
    AND has_company_permission('sales_view', "companyId")
    AND id IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );


ALTER POLICY "Customers with sales_update can update their own organization" ON "customer"
  USING (
    has_role('customer', "companyId") 
    AND has_company_permission('sales_update', "companyId")
    AND id IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );


ALTER POLICY "Customers with sales_view can their own customer contacts" ON "customerContact"
  USING (
    has_role('customer', get_company_id_from_foreign_key("customerId", 'customer')) AND
    has_company_permission('sales_view', get_company_id_from_foreign_key("customerId", 'customer'))
    AND "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );


ALTER POLICY "Customers with sales_create can create customer contacts" ON "customerContact"
  WITH CHECK (
    has_role('customer', get_company_id_from_foreign_key("customerId", 'customer')) AND
    has_company_permission('sales_create', get_company_id_from_foreign_key("customerId", 'customer'))
    AND "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Customers with sales_update can update their customer contacts" ON "customerContact"
  USING (
    has_role('customer', get_company_id_from_foreign_key("customerId", 'customer')) 
    AND has_company_permission('sales_update', get_company_id_from_foreign_key("customerId", 'customer'))
    AND "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );


ALTER POLICY "Suppliers with purchasing_view can their own organization" ON "supplier"
  USING (
    has_role('supplier', "companyId")
    AND has_company_permission('purchasing_view', "companyId")
    AND id IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );


ALTER POLICY "Suppliers with purchasing_update can update their own organization" ON "supplier"
  USING (
    has_role('supplier', "companyId") 
    AND has_company_permission('purchasing_update', "companyId")
    AND id IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );


ALTER POLICY "Suppliers with purchasing_view can their own supplier contacts" ON "supplierContact"
  USING (
    has_role('supplier', get_company_id_from_foreign_key("supplierId", 'supplier')) AND
    has_company_permission('purchasing_view', get_company_id_from_foreign_key("supplierId", 'supplier'))
    AND "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Anyone can read public buckets"
ON storage.objects USING (
    bucket_id = 'public'
    AND ((SELECT auth.role()) = 'authenticated')
);

ALTER POLICY "Anyone with settings_create can insert into the public bucket"
ON storage.objects WITH CHECK (
    bucket_id = 'public' 
    AND (
        (storage.foldername(name))[1] = ANY(
            get_permission_companies('settings_create')
        )
    )
);

ALTER POLICY "Anyone with settings_update can update the public bucket"
ON storage.objects USING (
    bucket_id = 'public'
    AND (
        (storage.foldername(name))[1] = ANY(
            get_permission_companies('settings_update')
        )
    )
);

ALTER POLICY "Anyone with settings_delete can delete from public bucket"
ON storage.objects USING (
    bucket_id = 'public'
    AND (
        (storage.foldername(name))[1] = ANY(
            get_permission_companies('settings_delete')
        )
    )
);


ALTER POLICY "Employees can view notes" ON "note"
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can insert notes" ON "note"
  WITH CHECK (   
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )  
);

ALTER POLICY "Employees can update their own notes" ON "note"
  USING (
   has_role('employee', "companyId")
    AND "createdBy"::uuid = (SELECT auth.uid())
  );

ALTER POLICY "Employees can delete their own notes" ON "note"
  USING (
    has_role('employee', "companyId")
    AND "createdBy"::uuid = (SELECT auth.uid())
  );

ALTER POLICY "Employees can view locations for their companies" ON "location"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view shifts" ON "shift"
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view employee jobs" ON "employeeJob"
  USING (
    has_role('employee', "companyId") AND 
    "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view departments" ON "department"
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view holidays" ON "holiday"
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Authenticated users can view currencies" ON "currency"
  USING (
    (SELECT auth.role()) = 'authenticated' 
  );

DROP POLICY "Authenticated users can view units of measure" ON "unitOfMeasure";
CREATE POLICY "Employees can view units of measure" ON "unitOfMeasure" FOR SELECT
  USING (
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view items" ON "item"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view parts" ON "part"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Suppliers with parts_view can view their own part suppliers" ON "supplierPart"
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_view', "companyId") AND
    "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Suppliers with parts_view can view items they created or supply" ON "item"
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_view', "companyId")
    AND (
      "createdBy" = (SELECT auth.uid())::text
      OR (
        id IN (
          SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )              
      ) 
    )
  );

ALTER POLICY "Suppliers with parts_update can update parts that they created or supply" ON "item"
  WITH CHECK (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
    AND (
      "createdBy" = (SELECT auth.uid())::text
      OR (
        id IN (
          SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )              
      ) 
    )
  );

ALTER POLICY "Suppliers with parts_delete can delete items that they created or supply" ON "item"
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
    AND (
      "createdBy" = (SELECT auth.uid())::text
      OR (
        id IN (
          SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )              
      ) 
    ) 
  );

ALTER POLICY "Suppliers with parts_view can view parts they created or supply" ON "part"
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_view', "companyId")
    AND (
      "createdBy" = (SELECT auth.uid())::text
      OR (
        "itemId" IN (
          SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )              
      ) 
    )
  );

ALTER POLICY "Supliers with parts_create can insert parts" ON "part"
  WITH CHECK (   
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
  );

ALTER POLICY "Suppliers with parts_update can update parts that they created or supply" ON "part"
  WITH CHECK (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
    AND (
      "createdBy" = (SELECT auth.uid())::text
      OR (
        "itemId" IN (
          SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )              
      ) 
    )
  );

ALTER POLICY "Suppliers with parts_delete can delete parts that they created or supply" ON "part"
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_create', "companyId")
    AND (
      "createdBy" = (SELECT auth.uid())::text
      OR (
        "itemId" IN (
          SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
              SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )              
      ) 
    ) 
  );

ALTER POLICY "Suppliers with parts_view can view item costs they supply" ON "itemCost"
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_view', "companyId")
    AND (
      "itemId" IN (
        SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )                 
    )
  );

ALTER POLICY "Suppliers with parts_update can update parts costs that they supply" ON "itemCost"
  WITH CHECK (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_update', "companyId")
    AND (
      "itemId" IN (
        SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )                 
    )
  );

ALTER POLICY "Suppliers with parts_view can view part replenishment they supply" ON "itemReplenishment"
  USING (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_view', "companyId")
    AND (
      "itemId" IN (
        SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )               
    )
  );

ALTER POLICY "Suppliers with parts_update can update parts replenishments that they supply" ON "itemReplenishment"
  WITH CHECK (
    has_role('supplier', "companyId") AND
    has_company_permission('parts_update', "companyId")
    AND (
      "itemId" IN (
        SELECT "itemId" FROM "supplierPart" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )                
    )
  );


ALTER POLICY "Employees can view warehouses" ON "warehouse"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Authenticated users can view shelves" ON "shelf"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Authenticated users can view shelves" ON "shelf"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );



ALTER POLICY "Users with documents can view documents where they are in the readGroups" ON "document" 
  USING (
    has_company_permission('documents_view', "companyId") AND
    ((SELECT(groups_for_user((SELECT auth.uid())::text)) && "readGroups") = true)
  );

ALTER POLICY "Users with documents_create can create documents where they are in the writeGroups" ON "document" 
  WITH CHECK (
    has_company_permission('documents_create', "companyId") AND
    ((SELECT(groups_for_user((SELECT auth.uid())::text)) && "writeGroups") = true)
  );

ALTER POLICY "Users with documents_update can update documents where they are in the writeGroups" ON "document"
  USING (
    has_company_permission('documents_update', "companyId") AND
    ((SELECT(groups_for_user((SELECT auth.uid())::text)) && "writeGroups") = true)
  );

ALTER POLICY "Users with documents_delete can delete documents where they are in the writeGroups" ON "document"
  USING (
    has_company_permission('documents_delete', "companyId") AND
    ((SELECT(groups_for_user((SELECT auth.uid())::text)) && "writeGroups") = true)
  );

ALTER POLICY "Private buckets view requires ownership or document.readGroups" ON storage.objects 
  USING (
    bucket_id = 'private'
    AND ((SELECT auth.role()) = 'authenticated')
    AND (
        (storage.foldername(name))[1] = (SELECT auth.uid())::text
        OR "name" IN (
            SELECT "path" FROM public.document WHERE ((SELECT(groups_for_user((SELECT auth.uid())::text)) && "readGroups") = true)
        )
    )
  );

ALTER POLICY "Private buckets insert requires ownership or document.writeGroups" ON storage.objects 
  WITH CHECK (
    bucket_id = 'private'
    AND ((SELECT auth.role()) = 'authenticated')
    AND has_any_company_permission('documents_create')
    AND (
        (storage.foldername(name))[1] = (SELECT auth.uid())::text
        OR "name" IN (
            SELECT "path" FROM public.document WHERE ((SELECT(groups_for_user((SELECT auth.uid())::text)) && "writeGroups") = true)
        )
    )
  );

ALTER POLICY "Private buckets update requires ownership or document.writeGroups" ON storage.objects 
  USING (
    bucket_id = 'private'
    AND ((SELECT auth.role()) = 'authenticated')
    AND has_any_company_permission('documents_update')
    AND (
        (storage.foldername(name))[1] = (SELECT auth.uid())::text
        OR "name" IN (
            SELECT "path" FROM public.document WHERE ((SELECT(groups_for_user((SELECT auth.uid())::text)) && "writeGroups") = true)
        )
    )
  );

ALTER POLICY "Private buckets delete requires ownership or document.writeGroups" ON storage.objects 
  USING (
    bucket_id = 'private'
    AND ((SELECT auth.role()) = 'authenticated')
    AND has_any_company_permission('documents_delete')
    AND (
        (storage.foldername(name))[1] = (SELECT auth.uid())::text
        OR "name" IN (
            SELECT "path" FROM public.document WHERE ((SELECT(groups_for_user((SELECT auth.uid())::text)) && "writeGroups") = true)
        )
    )
  );

ALTER POLICY "Users can view their own document favorites" ON "documentFavorite" 
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can create their own document favorites" ON "documentFavorite" 
  WITH CHECK (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can delete their own document favorites" ON "documentFavorite"
  USING (
    (SELECT auth.uid())::text = "userId"
  ); 

ALTER POLICY "Users can view their own purchase order favorites" ON "purchaseOrderFavorite" 
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can create their own purchase order favorites" ON "purchaseOrderFavorite" 
  WITH CHECK (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can delete their own purchase order favorites" ON "purchaseOrderFavorite"
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Suppliers with purchasing_view can their own purchase orders" ON "purchaseOrder"
  USING (
    has_company_permission('purchasing_view', "companyId") 
    AND has_role('supplier', "companyId") 
    AND "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Suppliers with purchasing_update can their own purchase orders" ON "purchaseOrder"
  USING (
    has_company_permission('purchasing_update', "companyId") 
    AND has_role('supplier', "companyId") 
    AND "supplierId" IN (
      SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Suppliers with purchasing_view can search for their own purchase orders" ON "search"
  USING (
    has_company_permission('purchasing_view', "companyId") 
    AND has_role('supplier', "companyId")
    AND entity = 'Purchase Order' 
    AND uuid IN (
        SELECT id FROM "purchaseOrder" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "purchaseOrder" WHERE "supplierId" IN (
            SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )
      )
  );

ALTER POLICY "Suppliers with purchasing_view can their own purchase order lines" ON "purchaseOrderLine"
  USING (
    has_company_permission('purchasing_view', "companyId") 
    AND has_role('supplier', "companyId") 
    AND "purchaseOrderId" IN (
      SELECT id FROM "purchaseOrder" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "purchaseOrder" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Suppliers with purchasing_create can create lines on their own purchase order" ON "purchaseOrderLine"
  WITH CHECK (
    has_company_permission('purchasing_create', "companyId") 
    AND has_role('supplier', "companyId") 
    AND "purchaseOrderId" IN (
      SELECT id FROM "purchaseOrder" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "purchaseOrder" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Suppliers with purchasing_update can their own purchase order lines" ON "purchaseOrderLine"
  USING (
    has_company_permission('purchasing_update', "companyId") 
    AND has_role('supplier', "companyId") 
    AND "purchaseOrderId" IN (
      SELECT id FROM "purchaseOrder" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "purchaseOrder" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Suppliers with purchasing_delete can delete lines on their own purchase order" ON "purchaseOrderLine"
  USING (
    has_company_permission('purchasing_delete', "companyId") 
    AND has_role('supplier', "companyId") 
    AND "purchaseOrderId" IN (
      SELECT id FROM "purchaseOrder" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "purchaseOrder" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Suppliers with purchasing_view can their own purchase order deliveries" ON "purchaseOrderDelivery"
  USING (
    has_company_permission('purchasing_view', "companyId") 
    AND has_role('supplier', "companyId") 
    AND id IN (
      SELECT id FROM "purchaseOrder" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "purchaseOrder" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Suppliers with purchasing_update can their own purchase order deliveries" ON "purchaseOrderDelivery"
  USING (
    has_company_permission('purchasing_update', "companyId") 
    AND has_role('supplier', "companyId") 
    AND id IN (
      SELECT id FROM "purchaseOrder" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "purchaseOrder" WHERE "supplierId" IN (
          SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Authenticated users can view integrations." ON "integration"
  USING (
    (SELECT auth.role()) = 'authenticated'
  );

ALTER POLICY "Authenticated users can view custom field tables" ON "customFieldTable"
  USING (
    (SELECT auth.role()) = 'authenticated'
  );


ALTER POLICY "Users can view their own sales order favorites" ON "salesOrderFavorite" 
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can create their own sales order favorites" ON "salesOrderFavorite" 
  WITH CHECK (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can delete their own sales order favorites" ON "salesOrderFavorite"
  USING (
    (SELECT auth.uid())::text = "userId"
  ); 

ALTER POLICY "Customers with sales_view can their own sales orders" ON "salesOrder"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Customers with sales_update can update their own sales orders" ON "salesOrder"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_update', "companyId")
    AND "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Customers with sales_view can search for their own sales orders" ON "search"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    entity = 'Sales Order' AND
    uuid IN (
        SELECT id FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
            SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )
      )
  );

ALTER POLICY "Customers with sales_view can their own sales order lines" ON "salesOrderLine"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    "salesOrderId" IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_create can create lines on their own sales order" ON "salesOrderLine"
  WITH CHECK (
    has_role('customer', "companyId") AND
    has_company_permission('sales_create', "companyId") AND
    "salesOrderId" IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_update can update their own sales order lines" ON "salesOrderLine"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_update', "companyId") AND
    "salesOrderId" IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_delete can delete lines on their own sales order" ON "salesOrderLine"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_delete', "companyId") AND
    "salesOrderId" IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_view can their own sales order shipments" ON "salesOrderShipment"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    id IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_update can their own sales order shipments" ON "salesOrderShipment"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_update', "companyId") AND
    id IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Employees can view tools" ON "tool"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view consumables" ON "consumable"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view fixtures" ON "fixture"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view items" ON "item"
  USING (
    has_role('employee', "companyId") 
    AND (
      "companyId" IS NULL OR
      "companyId" = ANY(
        select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
      )
    )
  );

ALTER POLICY "Authenticated users can view global material forms" ON "materialForm"
  USING (
    (SELECT auth.role()) = 'authenticated' AND
    "companyId" IS NULL
  );

ALTER POLICY "Employees can view material forms" ON "materialForm"
  USING (
    has_role('employee', "companyId") 
    AND (
      "companyId" IS NULL OR
      "companyId" = ANY(
        select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
      )
    )
  );

ALTER TABLE "materialSubstance" ENABLE ROW LEVEL SECURITY;
ALTER POLICY "Employees can view material substances" ON "materialSubstance"
  USING (
    has_role('employee', "companyId") 
    AND (
      "companyId" IS NULL OR
      "companyId" = ANY(
        select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
      )
    )
  );

ALTER POLICY "Authenticated users can view global material substances" ON "materialSubstance"
  USING (
    (SELECT auth.role()) = 'authenticated' AND
    "companyId" IS NULL
  );

ALTER POLICY "Employees can view materials" ON "material"
  USING (
    has_role('employee', "companyId") 
    AND (
      "companyId" IS NULL OR
      "companyId" = ANY(
        select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
      )
    )
  );



ALTER POLICY "Users can view their own salesRfq favorites" ON "salesRfqFavorite" 
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can create their own salesRfq favorites" ON "salesRfqFavorite" 
  WITH CHECK (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can delete their own salesRfq favorites" ON "salesRfqFavorite"
  USING (
    (SELECT auth.uid())::text = "userId"
  ); 

ALTER POLICY "Customer with sales_view can view their own sales rfqs" ON "salesRfq"
  USING (
    has_company_permission('sales_view', "companyId") AND 
    has_role('customer', "companyId") AND 
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Customers with sales_view can their own purchase order lines" ON "salesRfqLine"
  USING (
    has_company_permission('sales_view', "companyId") AND
    has_role('customer', "companyId") AND
    "salesRfqId" IN (
      SELECT id FROM "salesRfq" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesRfq" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Users can view their own quote favorites" ON "quoteFavorite" 
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can create their own quote favorites" ON "quoteFavorite" 
  WITH CHECK (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can delete their own quote favorites" ON "quoteFavorite"
  USING (
    (SELECT auth.uid())::text = "userId"
  ); 

ALTER POLICY "Customers with sales_view can their own quotes" ON "quote"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Customers with sales_update can their own quotes" ON "quote"
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId") AND
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Customers with sales_view can search for their own quotes" ON "search"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    entity = 'Quotation'  AND
    uuid IN (
        SELECT id FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "quote" WHERE "customerId" IN (
            SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
          )
        )
      )
  );

ALTER POLICY "Customers with sales_view can their own quote lines" ON "quoteLine"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_create can create lines on their own quote" ON "quoteLine"
  WITH CHECK (
    has_role('customer', "companyId") AND
    has_company_permission('sales_create', "companyId") AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_update can their own quote lines" ON "quoteLine"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_update', "companyId") AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

ALTER POLICY "Customers with sales_delete can delete lines on their own quote" ON "quoteLine"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_delete', "companyId") AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY "Customers with sales_view can their own quote make methods" ON "quoteMakeMethod";



ALTER POLICY "Employees can view processes" ON "process"
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );


ALTER POLICY "Employees can view work centers" ON "workCenter"
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can view work center/processes" ON "workCenterProcess"  
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );


ALTER POLICY "Authenticated users can view countries" ON "country" USING ((SELECT auth.role()) = 'authenticated');

ALTER POLICY "Employees can view jobs" ON "job"
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Customers with production_view can view their own jobs" ON "job"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('production_view', "companyId") AND
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
    )
  );

ALTER POLICY "Customers with production_view can search for their own jobs" ON "search"
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('production_view', "companyId") AND
    entity = 'Job' AND
    uuid IN (
      SELECT id FROM "job" WHERE "customerId" IN (
        SELECT "customerId" FROM "customerAccount" WHERE id::uuid = (SELECT auth.uid())
      )
    )
  );

ALTER POLICY "Employees can view job materials" ON "jobMaterial"
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

DROP POLICY "Customers with production_view can view their own job materials" ON "jobMaterial";


ALTER POLICY "Employees can view job operations" ON "jobOperation"
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

DROP POLICY "Customers with production_view can view their own job operations" ON "jobOperation";


ALTER POLICY "Users can view their own job favorites" ON "jobFavorite" 
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can create their own job favorites" ON "jobFavorite" 
  WITH CHECK (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can delete their own job favorites" ON "jobFavorite"
  USING (
    (SELECT auth.uid())::text = "userId"
  );



ALTER POLICY "Authenticated users can view currency codes" ON "currencyCode" 
  USING ((SELECT auth.role()) = 'authenticated');

ALTER POLICY "Employees can view production quantities" ON "productionQuantity"
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can insert production quantities" ON "productionQuantity"
  WITH CHECK (   
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )  
);

ALTER POLICY "Employees can delete production quantities" ON "productionQuantity"
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Employees can insert production events for their company's job operations" ON "productionEvent"
  WITH CHECK (
    has_role('employee', "companyId") AND
    (SELECT auth.uid())::text = "employeeId" AND
    "jobOperationId" IN (
      SELECT "id" FROM "jobOperation" WHERE "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
      )
    )
  );

ALTER POLICY "Employees can update production events for their company's job operations" ON "productionEvent"
  USING (
    (SELECT auth.uid())::text = "employeeId"
  );

ALTER POLICY "Employees can insert production quantities for their company's job operations" ON "productionQuantity"
  WITH CHECK (
    has_role('employee', "companyId") AND
    "jobOperationId" IN (
      SELECT "id" FROM "jobOperation" WHERE "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
      )
    )
  );



ALTER POLICY "Anyone can read the feedback buckets" ON storage.objects
  USING (
    bucket_id = 'feedback'
    AND ((SELECT auth.role()) = 'authenticated')
);

ALTER POLICY "Anyone with settings_create can insert into the feedback bucket" ON storage.objects
  WITH CHECK (
    bucket_id = 'feedback'
    AND ((SELECT auth.role()) = 'authenticated')
);

ALTER POLICY "Employees can view scrap reasons" ON "scrapReason"
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Users can view tags in their company" ON "tag"
  USING (
    (SELECT auth.uid())::text IN (
      SELECT "userId" FROM "userToCompany" WHERE "companyId" = "tag"."companyId"
    )
  );

ALTER POLICY "Users can insert tags in their company" ON "tag"
  WITH CHECK (
    (SELECT auth.uid())::text IN (
      SELECT "userId" FROM "userToCompany" WHERE "companyId" = "tag"."companyId"
    )
  );

ALTER POLICY "Authenticated users can view company settings" ON "companySettings"
  USING (
    (SELECT auth.role()) = 'authenticated' AND "id" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = (SELECT auth.uid())::text
    )
  );

ALTER POLICY "Users can view their own supplier quote favorites" ON "supplierQuoteFavorite" 
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can create their own supplier quote favorites" ON "supplierQuoteFavorite" 
  WITH CHECK (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Users can delete their own supplier quote favorites" ON "supplierQuoteFavorite"
  USING (
    (SELECT auth.uid())::text = "userId"
  );

ALTER POLICY "Suppliers with purchasing_create can create lines on their own supplier quote" ON "supplierQuoteLine"
  WITH CHECK (
    has_company_permission('purchasing_create', "companyId") 
    AND has_role('supplier', "companyId") 
    AND "supplierQuoteId" IN (
      SELECT id FROM "supplierQuote" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
      )
    )
  );

ALTER POLICY "Suppliers with purchasing_view can view their own quote line pricing" ON "supplierQuoteLinePrice"
  USING (
    has_company_permission('purchasing_view', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote')) 
    AND has_role('supplier', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote'))
    AND "supplierQuoteId" IN (
      SELECT id FROM "supplierQuote" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = (SELECT auth.uid())
      )
    )
  );

ALTER POLICY "Employees can view job operation tools" ON "jobOperationTool"
  USING (
    has_role('employee', "companyId") 
    AND "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = (SELECT auth.uid())::text
    )
);


DROP VIEW "salesRfqs";
CREATE OR REPLACE VIEW "salesRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  rfq.*,
  l."name" AS "locationName",
  opp."quoteId",
  opp."salesOrderId"
  FROM "salesRfq" rfq
  LEFT JOIN "location" l
    ON l.id = rfq."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."salesRfqId" = rfq.id;

DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType", 
    sl."orderTotal",
    sl."jobs",
    st."name" AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    l."name" AS "locationName"
  FROM "salesOrder" s
  LEFT JOIN (
    SELECT 
      sol."salesOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM((1+COALESCE(sol."taxPercent", 0))*(COALESCE(sol."saleQuantity", 0)*(COALESCE(sol."unitPrice", 0)) + COALESCE(sol."shippingCost", 0) + COALESCE(sol."addOnCost", 0))) AS "orderTotal",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        CASE 
          WHEN j.id IS NOT NULL THEN json_build_object('id', j.id, 'jobId', j."jobId", 'status', j."status")
          ELSE NULL 
        END
      ) FILTER (WHERE j.id IS NOT NULL) AS "jobs"
    FROM "salesOrderLine" sol
    LEFT JOIN "item" i
      ON i."id" = sol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    LEFT JOIN "job" j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol."id"
    GROUP BY sol."salesOrderId"
  ) sl ON sl."salesOrderId" = s."id"
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id"
  LEFT JOIN "location" l ON l."id" = ss."locationId";

DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    sm."name" AS "shippingMethodName",
    st."name" AS "shippingTermName",
    pt."name" AS "paymentTermName",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."dropShipment",
    l."id" AS "locationId",
    l."name" AS "locationName"
  FROM "purchaseOrder" p
  LEFT JOIN "purchaseOrderDelivery" pd ON pd."id" = p."id"
  LEFT JOIN "shippingMethod" sm ON sm."id" = pd."shippingMethodId"
  LEFT JOIN "shippingTerm" st ON st."id" = pd."shippingTermId"
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = pp."paymentTermId"
  LEFT JOIN "location" l ON l."id" = pd."locationId";


DROP VIEW IF EXISTS "quotes";
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  ql."thumbnailPath",
  ql."itemType",
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  opp."salesRfqId",
  opp."salesOrderId",
  qs."shippingCost"
  FROM "quote" q
  LEFT JOIN (
    SELECT 
      "quoteId",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" != 'No Quote') AS "lines",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" = 'Complete') AS "completedLines", 
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM "quoteLine"
    INNER JOIN "item" i
      ON i."id" = "quoteLine"."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "quoteShipment" qs ON qs."id" = q."id"
  LEFT JOIN "location" l
    ON l.id = q."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."quoteId" = q.id;

DROP VIEW IF EXISTS "supplierQuotes";
CREATE OR REPLACE VIEW "supplierQuotes"
WITH
  (SECURITY_INVOKER = true) AS
SELECT
  q.*,
  ql."thumbnailPath",
  ql."itemType"
FROM
  "supplierQuote" q
  LEFT JOIN (
    SELECT
      "supplierQuoteId",
      MIN(
        CASE
          WHEN i."thumbnailPath" IS NULL
          AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
          ELSE i."thumbnailPath"
        END
      ) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM
      "supplierQuoteLine"
      INNER JOIN "item" i ON i."id" = "supplierQuoteLine"."itemId"
      LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY
      "supplierQuoteId"
  ) ql ON ql."supplierQuoteId" = q.id;