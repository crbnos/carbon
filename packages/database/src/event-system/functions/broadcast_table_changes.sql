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
  -- A database without Supabase Realtime (a self-hosted install that does not
  -- run it) has nothing to send to: the write must still succeed.
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RETURN NULL;
  END IF;

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
    'WITH keyed AS (
       SELECT coalesce(c->>''companyId'',
                       CASE WHEN $2::text = ''implementationHub'' THEN c->>''id'' END) AS company_id,
              c
         FROM (%s) changed
     )
     SELECT k.company_id,
            count(*) AS n,
            -- itemSupersession has no id: its row belongs to the item it describes.
            jsonb_agg(coalesce(k.c->''id'', k.c->''itemId''))
              FILTER (WHERE k.c ? ''id'' OR k.c ? ''itemId'') AS ids,
            -- The records these rows belong to: every "<name>Id" column and its
            -- values, so a page showing one job (or quote, or order) can ignore
            -- changes to another''s rows. A column with more than 20 values is
            -- left out, and a client treats a missing column as "may concern me".
            -- Only computed for a statement small enough to list its ids.
            CASE WHEN count(*) <= 100 THEN (
              SELECT jsonb_object_agg(p.key, p.vals)
                FROM (
                  SELECT e.key, jsonb_agg(DISTINCT e.value) AS vals
                    FROM keyed k2, jsonb_each(k2.c) e
                   WHERE k2.company_id = k.company_id
                     AND e.key LIKE ''%%Id'' AND e.key <> ''companyId''
                     AND jsonb_typeof(e.value) = ''string''
                   GROUP BY e.key
                  HAVING count(DISTINCT e.value) <= 20
                ) p
            ) END AS parents
       FROM keyed k
      GROUP BY k.company_id',
    changed_rows
  ) USING ignored_columns, TG_TABLE_NAME
  LOOP
    CONTINUE WHEN rec.company_id IS NULL;
    PERFORM realtime.send(
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'op', TG_OP,
        -- null = "many rows changed, or the table has no id: resync"
        'ids', CASE WHEN rec.n <= 100 THEN rec.ids END,
        -- ponytail: an UPDATE that moves a row to another parent names the new
        -- parent only; add the old row's values here if re-parenting must be live.
        'parents', rec.parents
      ),
      TG_OP,
      'company:' || rec.company_id || ':' || TG_TABLE_NAME,
      true
    );
  END LOOP;
  RETURN NULL;
END;
$function$;
