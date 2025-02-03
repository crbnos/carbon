CREATE TABLE "webhookTable" (
  "table" TEXT NOT NULL,
  "module" module NOT NULL,
  "name" TEXT NOT NULL,

  CONSTRAINT "webhookTable_pkey" PRIMARY KEY ("table"),
  CONSTRAINT "webhookTable_name_key" UNIQUE ("name")
);

ALTER TABLE "webhookTable" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "webhookTable"
FOR SELECT
USING (
  auth.role() = 'authenticated'
);

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('quote', 'Sales', 'Quote'),
('salesOrder', 'Sales', 'Sales Order'),
('salesRfq', 'Sales', 'Sales RFQ');


CREATE TABLE "webhook" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "table" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "onInsert" BOOLEAN NOT NULL DEFAULT FALSE,
  "onUpdate" BOOLEAN NOT NULL DEFAULT FALSE,
  "onDelete" BOOLEAN NOT NULL DEFAULT FALSE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "webhook_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_table_fkey" FOREIGN KEY ("table") REFERENCES "webhookTable"("table") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "webhook_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "webhook" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."webhook"
FOR SELECT
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."webhook"
FOR INSERT
WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."webhook"
FOR UPDATE
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."webhook"
FOR DELETE
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_delete')
    )::text[]
  )
);