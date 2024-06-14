CREATE OR REPLACE FUNCTION public.create_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  CASE new.type
    WHEN 'Part' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new."readableId", '/x/part/' || new."id", new."companyId");
    WHEN 'Service' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new."readableId", '/x/service/' || new."id", new."companyId");
    WHEN 'Tool' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new."readableId", '/x/tool/' || new."id", new."companyId");
    WHEN 'Consumable' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new."readableId", '/x/consumable/' || new."id", new."companyId");
    WHEN 'Material' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new."readableId", '/x/material/' || new."id", new."companyId");
    WHEN 'Fixture' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new."readableId", '/x/fixture/' || new."id", new."companyId");
  END CASE;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE "search" ALTER COLUMN "companyId" DROP NOT NULL;


ALTER POLICY "Employees with parts can search for parts" ON "search"
  USING (
    (
      "companyId" = NULL OR
      has_company_permission('parts_view', "companyId") 
    ) AND entity = 'Part' AND has_role('employee')
  );
