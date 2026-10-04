CREATE OR REPLACE FUNCTION public.broadcast_reference_changes()
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
  -- A database without Supabase Realtime (a self-hosted install that does not
  -- run it) has nothing to send to: the write must still succeed.
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RETURN NULL;
  END IF;

  -- Tells the company's clients that a reference list changed (one shared topic, company:<companyId>:reference).
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
    'SELECT DISTINCT c->>''companyId'' AS company_id FROM (%s) changed',
    changed_rows
  ) USING ignored_columns
  LOOP
    CONTINUE WHEN rec.company_id IS NULL;
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP),
      TG_OP,
      'company:' || rec.company_id || ':reference',
      true
    );
  END LOOP;
  RETURN NULL;
END;
$function$;
