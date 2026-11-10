CREATE OR REPLACE FUNCTION util.action_levels()
 RETURNS TABLE(action text, level public."permissionLevel")
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Generated from packages/database/src/access/levels.ts (authz/registry-sql.ts). Do not edit.
  -- Each action of a '<page>_<action>' key and the lowest level that holds it.
  VALUES ('view', 'View'::public."permissionLevel"), ('create', 'Create'::public."permissionLevel"), ('update', 'Edit'::public."permissionLevel"), ('delete', 'Full'::public."permissionLevel")
$function$;
