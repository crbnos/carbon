CREATE OR REPLACE FUNCTION public.broadcast_table_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ignored_columns CONSTANT TEXT[] := ARRAY['updatedAt', 'updatedBy', 'embedding'];
  -- Tables whose rows hang off a record through another table. Each hop is
  -- [column of the row, table it points at, column to read there]: its value is
  -- added to the message under that column's name, so a job page can follow
  -- "jobId" on a table that only knows its operation.
  -- packages/database/src/realtime-tables.ts lists the same columns
  -- (REALTIME_ANCESTOR_COLUMNS; realtime-tables.test.ts keeps them equal).
  ancestors CONSTANT JSONB := '{
    "productionEvent": [["jobOperationId", "jobOperation", "jobId"]],
    "jobOperationStep": [["operationId", "jobOperation", "jobId"]],
    "jobOperationStepRecord": [["jobOperationStepId", "jobOperationStep", "operationId"], ["operationId", "jobOperation", "jobId"]]
  }';
  changed_rows TEXT;
  parent_rows TEXT;
  parents JSONB;
  found JSONB;
  hop JSONB;
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
    -- The rows as they were, too: a row moved to another parent concerns the
    -- parent it left as much as the one it joined.
    parent_rows := '(' || changed_rows || ')
                    UNION ALL
                    (SELECT to_jsonb(o) - $1 FROM batched_old o
                     EXCEPT
                     SELECT to_jsonb(n) - $1 FROM batched_new n)';
  ELSIF TG_OP = 'DELETE' THEN
    changed_rows := 'SELECT to_jsonb(o) AS c FROM batched_old o';
    parent_rows := changed_rows;
  ELSE
    changed_rows := 'SELECT to_jsonb(n) AS c FROM batched_new n';
    parent_rows := changed_rows;
  END IF;

  FOR rec IN EXECUTE format(
    -- implementationHub has no companyId: its id is the company id.
    'WITH keyed AS (
       SELECT coalesce(c->>''companyId'',
                       CASE WHEN $2::text = ''implementationHub'' THEN c->>''id'' END) AS company_id,
              c
         FROM (%1$s) changed
     ),
     related AS (
       SELECT coalesce(c->>''companyId'',
                       CASE WHEN $2::text = ''implementationHub'' THEN c->>''id'' END) AS company_id,
              c
         FROM (%2$s) changed
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
                    FROM related k2, jsonb_each(k2.c) e
                   WHERE k2.company_id = k.company_id
                     AND e.key LIKE ''%%Id'' AND e.key <> ''companyId''
                     AND jsonb_typeof(e.value) = ''string''
                   GROUP BY e.key
                  HAVING count(DISTINCT e.value) <= 20
                ) p
            ) END AS parents
       FROM keyed k
      GROUP BY k.company_id',
    changed_rows, parent_rows
  ) USING ignored_columns, TG_TABLE_NAME
  LOOP
    CONTINUE WHEN rec.company_id IS NULL;

    parents := rec.parents;
    IF parents IS NOT NULL AND ancestors ? TG_TABLE_NAME THEN
      FOR hop IN SELECT value FROM jsonb_array_elements(ancestors->TG_TABLE_NAME) LOOP
        -- A column that was left out (no value, or too many) leaves its
        -- ancestor out as well: the client then takes the change as its own.
        EXIT WHEN NOT parents ? (hop->>0);
        EXECUTE format(
          'SELECT jsonb_agg(DISTINCT %I) FROM public.%I
            WHERE "companyId" = $1 AND id IN (SELECT jsonb_array_elements_text($2))',
          hop->>2, hop->>1
        ) INTO found USING rec.company_id, parents->(hop->>0);
        EXIT WHEN found IS NULL;
        parents := parents || jsonb_build_object(hop->>2, found);
      END LOOP;
    END IF;
    PERFORM realtime.send(
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'op', TG_OP,
        -- null = "many rows changed, or the table has no id: resync"
        'ids', CASE WHEN rec.n <= 100 THEN rec.ids END,
        'parents', parents
      ),
      TG_OP,
      'company:' || rec.company_id || ':' || TG_TABLE_NAME,
      true
    );
  END LOOP;
  RETURN NULL;
END;
$function$;
