CREATE OR REPLACE FUNCTION public.check_workflow_version_lock(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The published version runs as the workflow's owner, so an API role may only
  -- move its nodes (updateWorkflowNodePositions); mirrors checkWorkflowVersionLock.
  IF p_operation <> 'UPDATE'
     OR current_setting('role', true) IN ('anon', 'authenticated') IS NOT TRUE THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."workflow" w
     WHERE w.id = p_old->>'workflowId'
       AND w."companyId" = p_old->>'companyId'
       AND w."publishedVersionId" = p_old->>'id'
  ) THEN
    RETURN;
  END IF;

  IF (p_new - 'nodes' - 'updatedAt' - 'updatedBy') IS NOT DISTINCT FROM (p_old - 'nodes' - 'updatedAt' - 'updatedBy')
     AND jsonb_typeof(p_new->'nodes') = 'array'
     AND jsonb_typeof(p_old->'nodes') = 'array' THEN
    -- Same nodes in the same order once each node's position is set aside.
    IF jsonb_array_length(p_new->'nodes') = jsonb_array_length(p_old->'nodes')
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(p_new->'nodes') WITH ORDINALITY AS n(node, i)
           JOIN jsonb_array_elements(p_old->'nodes') WITH ORDINALITY AS o(node, i) USING (i)
          WHERE (CASE WHEN jsonb_typeof(n.node) = 'object' THEN n.node - 'position' ELSE n.node END)
                IS DISTINCT FROM
                (CASE WHEN jsonb_typeof(o.node) = 'object' THEN o.node - 'position' ELSE o.node END)
       ) THEN
      RETURN;
    END IF;
  END IF;

  RAISE EXCEPTION 'This version is published. Create a new version to make changes.'
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;
