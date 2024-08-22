-- Here is a handy query to check the security_invoker value for all views
-- select 
--   relname, 
--   case 
--     when lower(reloptions::text)::text[] && array['security_invoker=1','security_invoker=true','security_invoker=on'] 
--       then true else false
--   end as security_invoker
-- from pg_class
--   join pg_catalog.pg_namespace n on n.oid = pg_class.relnamespace
-- where n.nspname = 'public' and relkind='v';

-- companies
ALTER VIEW "companies" SET (security_invoker = on);

-- employeeSummary
ALTER VIEW "employeeSummary" SET (security_invoker = on);

-- groupMembers
ALTER VIEW "groupMembers" SET (security_invoker = on);

-- groups
ALTER VIEW "groups" SET (security_invoker = on);

-- groups_recursive
ALTER VIEW "groups_recursive" SET (security_invoker = on);

-- holidayYears
ALTER VIEW "holidayYears" SET (security_invoker = on);

-- itemQuantities
ALTER VIEW "itemQuantities" SET (security_invoker = on);

-- modules
ALTER VIEW "modules" SET (security_invoker = on);

-- userDefaults
ALTER VIEW "userDefaults" SET (security_invoker = on);
