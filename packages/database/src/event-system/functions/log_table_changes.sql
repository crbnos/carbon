CREATE OR REPLACE FUNCTION public.log_table_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ignored_columns CONSTANT TEXT[] := ARRAY['updatedAt', 'updatedBy', 'embedding'];
  changed_rows TEXT;
BEGIN
  -- Records which rows of this table changed, in public."tableChange", so a
  -- client that kept a copy of a list can ask "what changed since I last
  -- looked?" (table_changes_since) and re-read only those rows instead of the
  -- whole table. A broadcast tells an open tab the same thing; this is for the
  -- tab that was closed, or disconnected, when it happened.
  IF TG_OP = 'UPDATE' THEN
    -- A row whose only changes are in ignored_columns drops out (the rule
    -- dispatch_event_batch applies; event-dispatch.test.ts keeps the lists equal).
    changed_rows := 'SELECT to_jsonb(n) - $1 AS c FROM batched_new n
                     EXCEPT
                     SELECT to_jsonb(o) - $1 FROM batched_old o';
  ELSIF TG_OP = 'DELETE' THEN
    changed_rows := 'SELECT to_jsonb(o) AS c FROM batched_old o';
  ELSE
    changed_rows := 'SELECT to_jsonb(n) AS c FROM batched_new n';
  END IF;

  EXECUTE format(
    -- One log row per changed row. Past 100 rows in one statement, a single row
    -- with a null "rowId" says "this table changed a lot: read it again".
    -- itemSupersession has no id: its row belongs to the item it describes.
    'INSERT INTO public."tableChange" ("companyId", "table", "rowId")
     SELECT DISTINCT company_id, $2::text, CASE WHEN n <= 100 THEN row_id END
       FROM (
         SELECT c->>''companyId'' AS company_id,
                coalesce(c->>''id'', c->>''itemId'') AS row_id,
                count(*) OVER (PARTITION BY c->>''companyId'') AS n
           FROM (%s) changed
       ) rows
      WHERE company_id IS NOT NULL',
    changed_rows
  ) USING ignored_columns, TG_TABLE_NAME;
  RETURN NULL;
END;
$function$;
