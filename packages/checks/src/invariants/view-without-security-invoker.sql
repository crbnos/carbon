-- invariant: every view in "public" runs as its caller
-- returns rows that VIOLATE the rule (none = healthy)
--
-- Every view in "public" is a PostgREST endpoint, reachable with the anon key
-- the apps publish. A view without security_invoker runs as its owner, so the
-- RLS on the tables underneath never sees the querying role and the view serves
-- every company's rows to anyone (openJobMaterialLines,
-- 20260926093417_open-job-material-lines-invoker).
--
-- The no-view-without-invoker conformance check catches this in a migration's
-- text; this catches it in the live catalog, whatever put it there.
--
-- Excluded by name, each holding no tenant data:
--   modules            — unnest(enum_range(NULL::module))
--   eventSystemTrigger — trigger metadata from pg_trigger
-- Materialized views are not listed: they cannot run as the caller at all, and
-- must instead have SELECT revoked from anon and authenticated.
SELECT c.relname AS view
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'v'
  AND c.relname NOT IN ('modules', 'eventSystemTrigger')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  AND NOT COALESCE(
    (SELECT option_value::boolean
       FROM pg_options_to_table(c.reloptions)
      WHERE option_name = 'security_invoker'),
    false
  )
ORDER BY 1;
