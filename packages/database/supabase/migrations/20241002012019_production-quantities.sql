CREATE TYPE "productionQuantityType" AS ENUM (
  'Rework',
  'Scrap',
  'Production'
);

CREATE TABLE "productionQuantity" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobOperationId" TEXT NOT NULL,
  "type" "productionQuantityType" NOT NULL DEFAULT 'Production',
  "quantity" INTEGER NOT NULL,
  "setupProductionEventId" TEXT,
  "laborProductionEventId" TEXT,
  "machineProductionEventId" TEXT,
  "scrapReason" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "productionQuantity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "productionQuantity_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation" ("id"),
  CONSTRAINT "productionQuantity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id"),
  CONSTRAINT "productionQuantity_setupProductionEventId_fkey" FOREIGN KEY ("setupProductionEventId") REFERENCES "productionEvent" ("id"),
  CONSTRAINT "productionQuantity_laborProductionEventId_fkey" FOREIGN KEY ("laborProductionEventId") REFERENCES "productionEvent" ("id"),
  CONSTRAINT "productionQuantity_machineProductionEventId_fkey" FOREIGN KEY ("machineProductionEventId") REFERENCES "productionEvent" ("id")
);

CREATE INDEX "productionQuantity_jobOperationId_idx" ON "productionQuantity" ("jobOperationId");
CREATE INDEX "productionQuantity_companyId_idx" ON "productionQuantity" ("companyId");
CREATE INDEX "productionQuantity_setupProductionEventId_idx" ON "productionQuantity" ("setupProductionEventId");
CREATE INDEX "productionQuantity_laborProductionEventId_idx" ON "productionQuantity" ("laborProductionEventId");
CREATE INDEX "productionQuantity_machineProductionEventId_idx" ON "productionQuantity" ("machineProductionEventId");

-- Enable Row Level Security for productionQuantity
ALTER TABLE "productionQuantity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view production quantities" ON "productionQuantity"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees can insert production quantities" ON "productionQuantity"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )  
);

CREATE POLICY "Employees can update production quantities" ON "productionQuantity"
  FOR UPDATE
  USING (
    has_role('employee', "companyId")
    AND has_company_permission('production_update', "companyId")
  );

CREATE POLICY "Employees can delete production quantities" ON "productionQuantity"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );


ALTER TABLE "productionQuantity" REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE "productionQuantity";

ALTER TABLE "jobOperation" REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE "jobOperation";

-- Function to update job operation quantities
CREATE OR REPLACE FUNCTION update_job_operation_quantities()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment quantities on insert
    UPDATE "jobOperation"
    SET 
      "quantityComplete" = "quantityComplete" + 
        CASE WHEN NEW."type" = 'Production' THEN NEW.quantity ELSE 0 END,
      "quantityReworked" = "quantityReworked" + 
        CASE WHEN NEW."type" = 'Rework' THEN NEW.quantity ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" + 
        CASE WHEN NEW."type" = 'Scrap' THEN NEW.quantity ELSE 0 END
    WHERE id = NEW."jobOperationId";
  ELSIF TG_OP = 'UPDATE' THEN
    -- Adjust quantities on update
    UPDATE "jobOperation"
    SET 
      "quantityComplete" = "quantityComplete" + 
        CASE 
          WHEN NEW."type" = 'Production' THEN NEW.quantity
          WHEN OLD."type" = 'Production' THEN -OLD.quantity
          ELSE 0 
        END,
      "quantityReworked" = "quantityReworked" + 
        CASE 
          WHEN NEW."type" = 'Rework' THEN NEW.quantity
          WHEN OLD."type" = 'Rework' THEN -OLD.quantity
          ELSE 0 
        END,
      "quantityScrapped" = "quantityScrapped" + 
        CASE 
          WHEN NEW."type" = 'Scrap' THEN NEW.quantity
          WHEN OLD."type" = 'Scrap' THEN -OLD.quantity
          ELSE 0 
        END
    WHERE id = NEW."jobOperationId";
  ELSIF TG_OP = 'DELETE' THEN
    -- Decrement quantities on delete
    UPDATE "jobOperation"
    SET 
      "quantityComplete" = "quantityComplete" - 
        CASE WHEN OLD."type" = 'Production' THEN OLD.quantity ELSE 0 END,
      "quantityReworked" = "quantityReworked" - 
        CASE WHEN OLD."type" = 'Rework' THEN OLD.quantity ELSE 0 END,
      "quantityScrapped" = "quantityScrapped" - 
        CASE WHEN OLD."type" = 'Scrap' THEN OLD.quantity ELSE 0 END
    WHERE id = OLD."jobOperationId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for INSERT
CREATE TRIGGER insert_production_quantity_trigger
AFTER INSERT ON "productionQuantity"
FOR EACH ROW
EXECUTE FUNCTION update_job_operation_quantities();

-- Create trigger for UPDATE
CREATE TRIGGER update_production_quantity_trigger
AFTER UPDATE ON "productionQuantity"
FOR EACH ROW
EXECUTE FUNCTION update_job_operation_quantities();

-- Create trigger for DELETE
CREATE TRIGGER delete_production_quantity_trigger
AFTER DELETE ON "productionQuantity"
FOR EACH ROW
EXECUTE FUNCTION update_job_operation_quantities();
