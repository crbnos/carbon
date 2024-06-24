ALTER TABLE "makeMethod" ADD COLUMN "customFields" JSONB;
ALTER TABLE "methodOperation" ADD COLUMN "customFields" JSONB;
ALTER TABLE "methodMaterial" ADD COLUMN "customFields" JSONB;
ALTER TABLE "methodMaterial" ADD COLUMN "itemReadableId" TEXT NOT NULL;
ALTER TABLE "methodMaterial" ADD COLUMN "description" TEXT NOT NULL;
ALTER TABLE "methodMaterial" ADD COLUMN "order" DOUBLE PRECISION NOT NULL DEFAULT 1;

INSERT INTO "customFieldTable" ("table", "module", "name")
VALUES 
  ('makeMethod', 'Items', 'Make Method'),
  ('methodOperation', 'Items', 'Method Operation'),
  ('methodMaterial', 'Items', 'Method Material');

ALTER TABLE "makeMethod" ADD CONSTRAINT "makeMethod_unique_itemId" UNIQUE ("itemId", "companyId");

CREATE FUNCTION public.create_make_method_related_records()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."makeMethod"("itemId", "createdBy", "companyId")
  VALUES (new."itemId", new."createdBy", new."companyId");
  
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_part_make_method_related_records
  AFTER INSERT on public.part
  FOR EACH ROW EXECUTE PROCEDURE public.create_make_method_related_records();

CREATE TRIGGER create_fixture_make_method_related_records
  AFTER INSERT on public.fixture
  FOR EACH ROW EXECUTE PROCEDURE public.create_make_method_related_records();


ALTER TABLE "methodOperation" ALTER COLUMN "description" SET NOT NULL;

CREATE TABLE "methodOperationWorkInstruction" (
  "methodOperationId" TEXT NOT NULL,
  "content" JSON DEFAULT '{"type": "doc","content": [{"type": "heading","attrs": {"level": 2},"content": [{"type": "text","text": "Work Instructions"}]},{"type": "paragraph"}]}'::json,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "methodOperationWorkInstruction_pkey" PRIMARY KEY ("methodOperationId"),
  CONSTRAINT "methodOperationWorkInstruction_methodOperationId_fkey" FOREIGN KEY ("methodOperationId") REFERENCES "methodOperation" ("id") ON DELETE CASCADE,
  CONSTRAINT "methodOperationWorkInstruction_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "methodOperationWorkInstruction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE FUNCTION public.create_method_operation_work_instruction()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."methodOperationWorkInstruction"("methodOperationId", "createdBy", "companyId")
  VALUES (new."id", new."createdBy", new."companyId");
  
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_part_make_method_related_records
  AFTER INSERT on public."methodOperation"
  FOR EACH ROW EXECUTE PROCEDURE public.create_method_operation_work_instruction();


ALTER TABLE "makeMethod" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view make methods" ON "makeMethod"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can create make methods" ON "makeMethod"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update make methods" ON "makeMethod"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete make methods" ON "makeMethod"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );

ALTER TABLE "methodMaterial" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view method materials" ON "methodMaterial"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can create method materials" ON "methodMaterial"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update method materials" ON "methodMaterial"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete method materials" ON "methodMaterial"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );

ALTER TABLE "methodOperation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with parts_view can view method operation" ON "methodOperation"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('parts_view', "companyId")
  );

CREATE POLICY "Employees with parts_create can create method operation" ON "methodOperation"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update method operation" ON "methodOperation"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete method operation" ON "methodOperation"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );

ALTER TABLE "methodOperationWorkInstruction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view work instructions" ON "methodOperationWorkInstruction"
  FOR SELECT
  USING (
    has_role('employee') AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with parts_create can create work instructions" ON "methodOperationWorkInstruction"
  FOR INSERT
  WITH CHECK (
    has_role('employee') AND
    has_company_permission('parts_create', "companyId")
  );

CREATE POLICY "Employees with parts_update can update work instructions" ON "methodOperationWorkInstruction"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('parts_update', "companyId")
  );

CREATE POLICY "Employees with parts_delete can delete work instructions" ON "methodOperationWorkInstruction"
  FOR DELETE
  USING (
    has_role('employee') AND
    has_company_permission('parts_delete', "companyId")
  );