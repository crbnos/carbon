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
