-- Drop existing triggers and functions
DROP TRIGGER IF EXISTS create_item_search_result ON public.item;
DROP FUNCTION IF EXISTS public.create_item_search_result();

DROP TRIGGER IF EXISTS update_item_search_result ON public.item;
DROP FUNCTION IF EXISTS public.update_item_search_result();

DROP TRIGGER IF EXISTS delete_item_search_result ON public.item;
DROP FUNCTION IF EXISTS public.delete_item_search_result();

-- Add new values to the search entity enum
ALTER TYPE "searchEntity" ADD VALUE IF NOT EXISTS 'Service';
ALTER TYPE "searchEntity" ADD VALUE IF NOT EXISTS 'Tool';
ALTER TYPE "searchEntity" ADD VALUE IF NOT EXISTS 'Consumable';
ALTER TYPE "searchEntity" ADD VALUE IF NOT EXISTS 'Material';
ALTER TYPE "searchEntity" ADD VALUE IF NOT EXISTS 'Fixture';
COMMIT;

-- Update the search policy to include the new entity types
DROP POLICY IF EXISTS "Employees with parts can search for parts" ON "search";

CREATE POLICY "Employees with parts can search for parts" ON "search"
  FOR SELECT
  USING (
    has_company_permission('parts_view', "companyId") 
    AND entity IN ('Part', 'Service', 'Tool', 'Consumable', 'Material', 'Fixture') 
    AND (get_my_claim('role'::text)) = '"employee"'::jsonb
  );



-- Recreate functions with updated logic
CREATE OR REPLACE FUNCTION public.create_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  CASE new.type
    WHEN 'Part' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new.id, '/x/part/' || new.id, new."companyId");
    WHEN 'Service' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Service', new.id, '/x/service/' || new.id, new."companyId");
    WHEN 'Tool' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Tool', new.id, '/x/tool/' || new.id, new."companyId");
    WHEN 'Consumable' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Consumable', new.id, '/x/consumable/' || new.id, new."companyId");
    WHEN 'Material' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Material', new.id, '/x/material/' || new.id, new."companyId");
    WHEN 'Fixture' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Fixture', new.id, '/x/fixture/' || new.id, new."companyId");
  END CASE;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.update_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old.name <> new.name OR old.description <> new.description OR old."readableId" <> new."readableId" OR old.type <> new.type) THEN
    UPDATE public.search 
    SET name = new."readableId", 
        description = new.name || ' ' || COALESCE(new.description, ''),
        link = CASE new.type
          WHEN 'Part' THEN '/x/part/' || new.id
          WHEN 'Service' THEN '/x/service/' || new.id
          WHEN 'Tool' THEN '/x/tool/' || new.id
          WHEN 'Consumable' THEN '/x/consumable/' || new.id
          WHEN 'Material' THEN '/x/material/' || new.id
          WHEN 'Fixture' THEN '/x/fixture/' || new.id
        END
    WHERE entity = 'Part' AND uuid = new.id AND "companyId" = new."companyId";
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.search WHERE entity = 'Part' AND uuid = old.id AND "companyId" = old."companyId";
  RETURN old;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate triggers
CREATE TRIGGER create_item_search_result
  AFTER INSERT ON public.item
  FOR EACH ROW EXECUTE PROCEDURE public.create_item_search_result();

CREATE TRIGGER update_item_search_result
  AFTER UPDATE ON public.item
  FOR EACH ROW EXECUTE PROCEDURE public.update_item_search_result();

CREATE TRIGGER delete_item_search_result
  AFTER DELETE ON public.item
  FOR EACH ROW EXECUTE PROCEDURE public.delete_item_search_result();
