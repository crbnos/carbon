CREATE OR REPLACE FUNCTION public.log_user_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ignored_columns CONSTANT TEXT[] := ARRAY['updatedAt', 'updatedBy', 'embedding'];
  changed_rows TEXT;
BEGIN
  -- A person's name and avatar live on the global "user" row, which has no
  -- company. Each company that person belongs to shows them in its people list
  -- (the employees view), so a change is logged once per company, as a change
  -- to that company's "employee" row.
  IF TG_OP = 'UPDATE' THEN
    changed_rows := 'SELECT to_jsonb(n) - $1 AS c FROM batched_new n
                     EXCEPT
                     SELECT to_jsonb(o) - $1 FROM batched_old o';
  ELSIF TG_OP = 'DELETE' THEN
    changed_rows := 'SELECT to_jsonb(o) AS c FROM batched_old o';
  ELSE
    changed_rows := 'SELECT to_jsonb(n) AS c FROM batched_new n';
  END IF;

  EXECUTE format(
    'INSERT INTO public."tableChange" ("companyId", "table", "rowId")
     SELECT DISTINCT m."companyId", ''employee'', changed.c->>''id''
       FROM (%s) changed
       JOIN public."userToCompany" m ON m."userId" = changed.c->>''id''',
    changed_rows
  ) USING ignored_columns;
  RETURN NULL;
END;
$function$;
