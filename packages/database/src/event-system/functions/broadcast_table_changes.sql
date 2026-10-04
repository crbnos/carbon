CREATE OR REPLACE FUNCTION public.broadcast_table_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ignored_columns CONSTANT TEXT[] := ARRAY['updatedAt', 'updatedBy', 'embedding'];
  changed_rows TEXT;
  rec RECORD;
BEGIN
  -- Tells the company's clients which rows of this table changed (topic company:<companyId>:<table>).
  -- Statement-level (attach_statement_handler): one message per company per
  -- statement, whatever the row count. No row data leaves the database: a client
  -- re-reads what it needs through PostgREST, so table RLS still decides what it sees.
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

  FOR rec IN EXECUTE format(
    -- implementationHub has no companyId: its id is the company id.
    'SELECT coalesce(c->>''companyId'',
                     CASE WHEN $2::text = ''implementationHub'' THEN c->>''id'' END) AS company_id,
            count(*) AS n,
            jsonb_agg(c->''id'') FILTER (WHERE c ? ''id'') AS ids
       FROM (%s) changed
      GROUP BY 1',
    changed_rows
  ) USING ignored_columns, TG_TABLE_NAME
  LOOP
    CONTINUE WHEN rec.company_id IS NULL;
    PERFORM realtime.send(
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'op', TG_OP,
        -- null = "many rows changed, or the table has no id: resync"
        'ids', CASE WHEN rec.n <= 100 THEN rec.ids END
      ),
      TG_OP,
      'company:' || rec.company_id || ':' || TG_TABLE_NAME,
      true
    );
  END LOOP;
  RETURN NULL;
END;
$function$;
