CREATE TYPE "salesOrderStatus" AS ENUM (
  'Draft',
  'Needs Approval',
  'Confirmed',
  'In Progress',
  'Completed',
  'Invoiced',
  'Cancelled'
);

CREATE TABLE "salesOrder" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "salesOrderId" TEXT NOT NULL,
  "revisionId" INTEGER NOT NULL DEFAULT 0,
  "status" "salesOrderStatus" NOT NULL DEFAULT 'Draft',
  "orderDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "notes" TEXT,
  "currencyCode" TEXT NOT NULL DEFAULT 'USD',
  "customerId" TEXT NOT NULL,
  "customerLocationId" TEXT,
  "customerContactId" TEXT,
  "customerReference" TEXT,
  "quoteId" TEXT,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "closedAt" DATE,
  "closedBy" TEXT,
  "customFields" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,


  CONSTRAINT "salesOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesOrder_salesOrderId_key" UNIQUE ("salesOrderId", "companyId"),
  CONSTRAINT "salesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrder_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency" ("code", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "salesOrder_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "salesOrder_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "customerContact" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "salesOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "salesOrder_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "salesOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesOrder_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesOrder_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "salesOrder_salesOrderId_idx" ON "salesOrder" ("salesOrderId", "companyId");
CREATE INDEX "salesOrder_customerId_idx" ON "salesOrder" ("customerId", "companyId");
CREATE INDEX "salesOrder_status_idx" ON "salesOrder" ("status", "companyId");
CREATE INDEX "salesOrder_quoteId_idx" ON "salesOrder" ("quoteId", "companyId");
CREATE INDEX "salesOrder_companyId_idx" ON "salesOrder" ("companyId");

CREATE TYPE "salesOrderLineType" AS ENUM (
  'Comment',
  'Part',
  'Material',
  'Tool',
  'Hardware',
  'Service',
  'Consumable',
  'Fixture',
  'Fixed Asset'
);

CREATE TABLE "salesOrderStatusHistory" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "salesOrderId" TEXT NOT NULL,
  "status" "salesOrderStatus" NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "salesOrderStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesOrderStatusHistory_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderStatusHistory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);


CREATE TABLE "salesOrderLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "salesOrderId" TEXT NOT NULL,
  "salesOrderLineType" "salesOrderLineType" NOT NULL,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "accountNumber" TEXT,
  "assetId" TEXT,
  "description" TEXT,
  "saleQuantity" NUMERIC(9,2) DEFAULT 0,
  "quantityToSend" NUMERIC(9,2) GENERATED ALWAYS AS (CASE WHEN "salesOrderLineType" = 'Comment' THEN 0 ELSE GREATEST(("saleQuantity" - "quantitySent"), 0) END) STORED,
  "quantitySent" NUMERIC(9,2) DEFAULT 0,
  "quantityToInvoice" NUMERIC(9,2) GENERATED ALWAYS AS (CASE WHEN "salesOrderLineType" = 'Comment' THEN 0 ELSE GREATEST(("saleQuantity" - "quantityInvoiced"), 0) END) STORED,
  "quantityInvoiced" NUMERIC(9,2) DEFAULT 0,
  "unitPrice" NUMERIC(9,2),
  "unitOfMeasureCode" TEXT,
  "locationId" TEXT,
  "shelfId" TEXT,
  "setupPrice" NUMERIC(9,2),
  "sentComplete" BOOLEAN NOT NULL DEFAULT FALSE,
  "invoicedComplete" BOOLEAN NOT NULL DEFAULT FALSE,
  "requiresInspection" BOOLEAN NOT NULL DEFAULT FALSE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "salesOrderLineType_number"
    CHECK (
      (
        "salesOrderLineType" = 'Comment' AND
        "itemId" IS NULL AND
        "accountNumber" IS NULL AND
        "assetId" IS NULL AND
        "description" IS NOT NULL
      )
      OR (
        (
          "salesOrderLineType" = 'Part' OR
          "salesOrderLineType" = 'Material' OR 
          "salesOrderLineType" = 'Tool' OR 
          "salesOrderLineType" = 'Hardware' OR 
          "salesOrderLineType" = 'Consumable' OR 
          "salesOrderLineType" = 'Fixture' OR 
          "salesOrderLineType" = 'Service'
        ) AND
        "itemId" IS NOT NULL AND
        "accountNumber" IS NULL AND
        "assetId" IS NULL 
      ) 
      OR (
        "salesOrderLineType" = 'Fixed Asset' AND
        "itemId" IS NULL AND
        "accountNumber" IS NULL AND
        "assetId" IS NOT NULL 
      )
    ),

  CONSTRAINT "salesOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesOrderLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesOrderLine_accountNumber_fkey" FOREIGN KEY ("accountNumber", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  -- TODO: Add assetId foreign key
  CONSTRAINT "salesOrderLine_shelfId_fkey" FOREIGN KEY ("shelfId", "locationId") REFERENCES "shelf" ("id", "locationId") ON DELETE CASCADE,
  CONSTRAINT "salesOrderLine_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesOrderLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesOrderLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "salesOrderLine_invoiceId_idx" ON "salesOrderLine" ("salesOrderId");

ALTER publication supabase_realtime ADD TABLE "salesOrderLine";

CREATE TABLE "salesOrderPayment" (
  "id" TEXT NOT NULL,
  "invoiceCustomerId" TEXT,
  "invoiceCustomerLocationId" TEXT,
  "invoiceCustomerContactId" TEXT,
  "paymentTermId" TEXT,
  "paymentComplete" BOOLEAN NOT NULL DEFAULT FALSE,
  "currencyCode" TEXT NOT NULL DEFAULT 'USD',
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "customFields" JSONB,

  CONSTRAINT "salesOrderPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesOrderPayment_id_fkey" FOREIGN KEY ("id") REFERENCES "salesOrder" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderPayment_invoiceCustomerId_fkey" FOREIGN KEY ("invoiceCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderPayment_invoiceCustomerLocationId_fkey" FOREIGN KEY ("invoiceCustomerLocationId") REFERENCES "customerLocation" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderPayment_invoiceCustomerContactId_fkey" FOREIGN KEY ("invoiceCustomerContactId") REFERENCES "customerContact" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderPayment_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "paymentTerm" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderPayment_currencyCode_fkey" FOREIGN KEY ("currencyCode", "companyId") REFERENCES "currency" ("code", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesOrderPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "salesOrderPayment_invoiceCustomerId_idx" ON "salesOrderPayment" ("invoiceCustomerId");
CREATE INDEX "salesOrderPayment_invoiceCustomerLocationId_idx" ON "salesOrderPayment" ("invoiceCustomerLocationId");
CREATE INDEX "salesOrderPayment_invoiceCustomerContactId_idx" ON "salesOrderPayment" ("invoiceCustomerContactId");
CREATE INDEX "salesOrderPayment_companyId_idx" ON "salesOrderPayment" ("companyId");

CREATE TABLE "salesOrderShipment" (
  "id" TEXT NOT NULL,
  "locationId" TEXT,
  "shippingMethodId" TEXT,
  "shippingTermId" TEXT,
  "receiptRequestedDate" DATE,
  "receiptPromisedDate" DATE,
  "deliveryDate" DATE,
  "notes" TEXT,
  "trackingNumber" TEXT,
  "dropShipment" BOOLEAN NOT NULL DEFAULT FALSE,
  "customerId" TEXT,
  "customerLocationId" TEXT,
  "supplierId" TEXT,
  "supplierLocationId" TEXT,
  "companyId" TEXT NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  "assignee" TEXT,

  CONSTRAINT "salesOrderShipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesOrderShipment_id_fkey" FOREIGN KEY ("id") REFERENCES "salesOrder" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderShipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderShipment_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderShipment_shippingTermId_fkey" FOREIGN KEY ("shippingTermId") REFERENCES "shippingTerm" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderShipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderShipment_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation" ("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderShipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "salesOrderShipment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "salesOrderShipment_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL
);

CREATE TYPE "salesOrderTransactionType" AS ENUM (
  'Edit',
  'Favorite',
  'Unfavorite',
  'Approved',
  'Reject',
  'Request Approval'
);

CREATE TABLE "salesOrderTransaction" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "salesOrderId" TEXT NOT NULL,
  "type" "salesOrderTransactionType" NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "salesOrderTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salesOrderTransaction_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "salesOrderTransaction_salesOrderId_idx" ON "salesOrderTransaction" ("salesOrderId");
CREATE INDEX "salesOrderTransaction_userId_idx" ON "salesOrderTransaction" ("userId");

CREATE TABLE "salesOrderFavorite" (
  "salesOrderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "salesOrderFavorites_pkey" PRIMARY KEY ("salesOrderId", "userId"),
  CONSTRAINT "salesOrderFavorites_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "salesOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "salesOrderFavorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "salesOrderFavorites_userId_idx" ON "salesOrderFavorite" ("userId");
CREATE INDEX "salesOrderFavorites_salesOrderId_idx" ON "salesOrderFavorite" ("salesOrderId");

ALTER TABLE "salesOrderFavorite" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sales order favorites" ON "salesOrderFavorite" 
  FOR SELECT USING (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can create their own sales order favorites" ON "salesOrderFavorite" 
  FOR INSERT WITH CHECK (
    auth.uid()::text = "userId"
  );

CREATE POLICY "Users can delete their own sales order favorites" ON "salesOrderFavorite"
  FOR DELETE USING (
    auth.uid()::text = "userId"
  ); 

CREATE OR REPLACE VIEW "salesOrders" AS
  SELECT
    s.*,
    sm."name" AS "shippingMethodName",
    st."name" AS "shippingTermName",
    pt."name" AS "paymentTermName",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    l."id" AS "locationId",
    l."name" AS "locationName",
    c."name" AS "customerName",
    u."avatarUrl" AS "createdByAvatar",
    u."fullName" AS "createdByFullName",
    u2."avatarUrl" AS "updatedByAvatar",
    u2."fullName" AS "updatedByFullName",
    u3."avatarUrl" AS "closedByAvatar",
    u3."fullName" AS "closedByFullName",
    EXISTS(SELECT 1 FROM "salesOrderFavorite" sf WHERE sf."salesOrderId" = s.id AND sf."userId" = auth.uid()::text) AS favorite
  FROM "salesOrder" s
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingMethod" sm ON sm."id" = ss."shippingMethodId"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = sp."paymentTermId"
  LEFT JOIN "location" l ON l."id" = ss."locationId"
  LEFT JOIN "customer" c ON c."id" = s."customerId"
  LEFT JOIN "user" u ON u."id" = s."createdBy"
  LEFT JOIN "user" u2 ON u2."id" = s."updatedBy"
  LEFT JOIN "user" u3 ON u3."id" = s."closedBy";


CREATE OR REPLACE VIEW "salesOrderCustomers" AS
  SELECT DISTINCT
    c."id",
    c."name",
    c."companyId"
  FROM "customer" c
  INNER JOIN "salesOrder" s ON s."customerId" = c."id";
  
ALTER TABLE "salesOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view, inventory_view, or invoicing_view can view sales orders" ON "salesOrder"
  FOR SELECT
  USING (
    (
      has_company_permission('sales_view', "companyId") OR
      has_company_permission('invoicing_view', "companyId")
    ) AND has_role('employee')
  );

CREATE POLICY "Customers with sales_view can their own sales orders" ON "salesOrder"
  FOR SELECT
  USING (
    has_role('customer') AND
    has_company_permission('sales_view', "companyId") AND
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
    )
  );

CREATE POLICY "Employees with sales_create can create sales orders" ON "salesOrder"
  FOR INSERT
  WITH CHECK (
    has_company_permission('sales_create', "companyId") AND has_role('employee')
  );


CREATE POLICY "Employees with sales_update can update sales orders" ON "salesOrder"
  FOR UPDATE
  USING (
    has_company_permission('sales_update', "companyId") AND has_role('employee')
  );

CREATE POLICY "Customers with sales_update can update their own sales orders" ON "salesOrder"
  FOR UPDATE
  USING (
    has_role('customer') AND
    has_company_permission('sales_update', "companyId")
    AND "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
    )
  );

CREATE POLICY "Employees with sales_delete can delete sales orders" ON "salesOrder"
  FOR DELETE
  USING (
    has_company_permission('sales_delete', "companyId") AND has_role('employee')
  );


CREATE POLICY "Customers with sales_view can search for their own sales orders" ON "search"
  FOR SELECT
  USING (
    has_role('customer') AND
    has_company_permission('sales_view', "companyId") AND
    entity = 'Sales Order' AND
    uuid IN (
        SELECT id FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
            SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
          )
        )
      )
  );

-- Search

CREATE FUNCTION public.create_sales_order_search_result()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.search(name, entity, uuid, link, "companyId")
  VALUES (new."salesOrderId", 'Sales Order', new.id, '/x/sales-order/' || new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_sales_order_search_result
  AFTER INSERT on public."salesOrder"
  FOR EACH ROW EXECUTE PROCEDURE public.create_sales_order_search_result();

CREATE FUNCTION public.update_sales_order_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old."salesOrderId" <> new."salesOrderId") THEN
    UPDATE public.search SET name = new."salesOrderId"
    WHERE entity = 'Sales Order' AND uuid = new.id AND "companyId" = new."companyId";
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_sales_order_search_result
  AFTER UPDATE on public."salesOrder"
  FOR EACH ROW EXECUTE PROCEDURE public.update_sales_order_search_result();

CREATE FUNCTION public.delete_sales_order_search_result()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.search WHERE entity = 'Sales Order' AND uuid = old.id AND "companyId" = old."companyId";
  RETURN old;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER delete_sales_order_search_result
  AFTER DELETE on public."salesOrder"
  FOR EACH ROW EXECUTE PROCEDURE public.delete_sales_order_search_result();


-- Sales Order Status History

ALTER TABLE "salesOrderStatusHistory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone with sales_view can view sales order status history" ON "salesOrderStatusHistory"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('sales_view', get_company_id_from_foreign_key("salesOrderId", 'salesOrder')) 
  );

-- Sales Order Lines

ALTER TABLE "salesOrderLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view sales order lines" ON "salesOrderLine"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Customers with sales_view can their own sales order lines" ON "salesOrderLine"
  FOR SELECT
  USING (
    has_role('customer') AND
    has_company_permission('sales_view', "companyId") AND
    "salesOrderId" IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_create can create sales order lines" ON "salesOrderLine"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Customers with sales_create can create lines on their own sales order" ON "salesOrderLine"
  FOR INSERT
  WITH CHECK (
    has_role('customer') AND
    has_company_permission('sales_create', "companyId") AND
    "salesOrderId" IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_update can update sales order lines" ON "salesOrderLine"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Customers with sales_update can update their own sales order lines" ON "salesOrderLine"
  FOR UPDATE
  USING (
    has_role('customer') AND
    has_company_permission('sales_update', "companyId") AND
    "salesOrderId" IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_delete can delete sales order lines" ON "salesOrderLine"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('sales_delete', "companyId")
  );

CREATE POLICY "Customers with sales_delete can delete lines on their own sales order" ON "salesOrderLine"
  FOR DELETE
  USING (
    has_role('customer') AND
    has_company_permission('sales_delete', "companyId") AND
    "salesOrderId" IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );


-- Sales Order Deliveries

ALTER TABLE "salesOrderShipment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view sales order shipments" ON "salesOrderShipment"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Customers with sales_view can their own sales order shipments" ON "salesOrderShipment"
  FOR SELECT
  USING (
    has_role('customer') AND
    has_company_permission('sales_view', "companyId") AND
    id IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_create can create sales order shipments" ON "salesOrderShipment"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Employees with sales_update can update sales order shipments" ON "salesOrderShipment"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Customers with sales_update can their own sales order shipments" ON "salesOrderShipment"
  FOR UPDATE
  USING (
    has_role('customer') AND
    has_company_permission('sales_update', "companyId") AND
    id IN (
      SELECT id FROM "salesOrder" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesOrder" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_delete can delete sales order shipments" ON "salesOrderShipment"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('sales_delete', "companyId")
  );


-- Sales Order Payments

ALTER TABLE "salesOrderPayment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view sales order payments" ON "salesOrderPayment"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Employees with sales_create can create sales order payments" ON "salesOrderPayment"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Employees with sales_update can update sales order payments" ON "salesOrderPayment"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete sales order payments" ON "salesOrderPayment"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('sales_delete', "companyId")
  );

ALTER VIEW "salesOrders" SET (security_invoker = on);
ALTER VIEW "salesOrderCustomers" SET (security_invoker = on);


DROP VIEW "customers";
CREATE OR REPLACE VIEW "customers" WITH(SECURITY_INVOKER=true) AS 
  SELECT 
    c.*,
    ct.name AS "type",
    cs.name AS "status",
    so.count AS "orderCount"
  FROM "customer" c
  LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
  LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId"
  LEFT JOIN (
    SELECT 
      "customerId",
      COUNT(*) AS "count"
    FROM "salesOrder"
    GROUP BY "customerId"
  ) so ON so."customerId" = c.id;

CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    sol.*,
    so."customerId",
    i.name AS "itemName",
    i.description AS "itemDescription"
  FROM "salesOrderLine" sol
    INNER JOIN "salesOrder" so 
      ON so.id = sol."salesOrderId"
    LEFT OUTER JOIN "item" i
      ON i.id = sol."itemId";
