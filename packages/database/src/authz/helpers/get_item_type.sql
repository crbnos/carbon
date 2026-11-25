CREATE OR REPLACE FUNCTION public.get_item_type(item_id text, company_id text)
 RETURNS "itemType"
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- An item's type, read past item's RLS, in one of the caller's companies only.
  -- The write policies of the item children that item's SELECT reads back
  -- (supplierPart, customerPartToItem) check the item's type through it: a
  -- subquery on item would run item's SELECT, which reads the child again, and
  -- Postgres refuses that as infinite recursion. Item's SELECT admits every
  -- employee of the company, so this tells the caller nothing it could not read.
  SELECT i.type
  FROM item i
  WHERE i.id = item_id
    AND i."companyId" = company_id
    AND company_id = ANY (get_companies_with_employee_role())
$function$;
