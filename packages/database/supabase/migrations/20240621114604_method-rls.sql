ALTER TABLE "methodOperation" ADD COLUMN "customFields" JSONB;
ALTER TABLE "methodMaterial" ADD COLUMN "customFields" JSONB;

INSERT INTO "customFieldTable" ("table", "module", "name")
VALUES 
  ('methodOperation', 'Items', 'Method Operation'),
  ('methodMaterial', 'Items', 'Method Material');


ALTER TABLE "makeMethod" ADD CONSTRAINT "makeMethod_unique_itemId" UNIQUE ("itemId", "companyId");

DROP TRIGGER IF EXISTS create_part_make_method_related_records ON public.part;
DROP TRIGGER IF EXISTS update_part_make_method_related_records ON public.part;

DROP FUNCTION IF EXISTS public.create_make_method_related_records();
DROP FUNCTION IF EXISTS public.update_make_method_related_records();

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