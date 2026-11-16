CREATE OR REPLACE FUNCTION util.page_max_level(p_page text)
 RETURNS "permissionLevel"
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Generated from packages/database/src/access/pages (authz/registry-sql.ts). Do not edit.
  -- A page's maxLevel below Full; NULL for a Full page and for anything else, which
  -- LEAST ignores. Constant arms and no SET search_path, so it inlines into
  -- util.access_level: a runtime cast or a SET would make it a call per level.
  SELECT CASE p_page
    WHEN 'accounting.syncTieOut' THEN 'View'::public."permissionLevel"
    WHEN 'accounting.fleet' THEN 'View'::public."permissionLevel"
    WHEN 'inventory.traceability' THEN 'View'::public."permissionLevel"
    WHEN 'invoicing.payables' THEN 'Create'::public."permissionLevel"
    WHEN 'invoicing.receivables' THEN 'Create'::public."permissionLevel"
    WHEN 'production.forecast' THEN 'View'::public."permissionLevel"
    WHEN 'production.outbound' THEN 'View'::public."permissionLevel"
    WHEN 'projects.reports' THEN 'View'::public."permissionLevel"
    WHEN 'quality.actions' THEN 'View'::public."permissionLevel"
    WHEN 'sales.projectContracts' THEN 'View'::public."permissionLevel"
    WHEN 'settings.auditLogs' THEN 'Edit'::public."permissionLevel"
    WHEN 'settings.itarCertifications' THEN 'View'::public."permissionLevel"
    WHEN 'workflows.runs' THEN 'View'::public."permissionLevel"
  END
$function$;
