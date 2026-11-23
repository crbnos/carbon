CREATE OR REPLACE FUNCTION public.queue_kanban_level_checks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  touched JSONB;
  target RECORD;
  below TEXT[];
BEGIN
  -- A seed, a restore or a test fixture loads ledger rows in bulk.
  -- The hourly sweep (util.sweep_kanban_levels) covers those.
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Only batched_new exists on INSERT and only batched_old on DELETE.
  IF TG_OP = 'DELETE' THEN
    SELECT jsonb_agg(DISTINCT jsonb_build_object(
      'companyId', "companyId", 'itemId', "itemId", 'storageUnitId', "storageUnitId"))
    INTO touched
    FROM batched_old
    WHERE "storageUnitId" IS NOT NULL;
  ELSE
    SELECT jsonb_agg(DISTINCT jsonb_build_object(
      'companyId', "companyId", 'itemId', "itemId", 'storageUnitId', "storageUnitId"))
    INTO touched
    FROM batched_new
    WHERE "storageUnitId" IS NOT NULL;
  END IF;

  IF touched IS NULL THEN
    RETURN NULL;
  END IF;

  FOR target IN
    SELECT k."companyId", array_agg(DISTINCT k."id") AS "kanbanIds"
    FROM jsonb_to_recordset(touched) AS t("companyId" TEXT, "itemId" TEXT, "storageUnitId" TEXT)
    JOIN "kanban" k
      ON k."companyId" = t."companyId"
     AND k."itemId" = t."itemId"
     AND k."storageUnitId" = t."storageUnitId"
    WHERE k."replenishmentSystem" = 'Transfer'
      AND k."replenishmentLevel" IS NOT NULL
    GROUP BY k."companyId"
  LOOP
    SELECT array_agg(p."kanbanId" ORDER BY p."kanbanId")
    INTO below
    FROM get_kanban_projected_quantities(target."companyId", target."kanbanIds") p
    WHERE p."projectedQuantity" < p."replenishmentLevel";

    IF below IS NOT NULL THEN
      PERFORM util.send_inngest_event(
        'carbon/kanban.level-check',
        jsonb_build_object('companyId', target."companyId", 'kanbanIds', to_jsonb(below))
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;
