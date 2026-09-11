-- Read catalog facts from the same database that serves the Swagger document.
-- The transaction-local search path makes pg_get_viewdef schema-qualified.
WITH scope AS MATERIALIZED (
  SELECT pg_catalog.set_config('search_path', '', true)
)
SELECT
  pg_catalog.pg_get_viewdef(view_relation.oid, false) AS view_definition,
  view_relation.relkind AS relation_kind,
  ARRAY(
    SELECT attribute.attname::text
    FROM pg_catalog.pg_constraint constraint_definition
    CROSS JOIN LATERAL unnest(constraint_definition.conkey) WITH ORDINALITY AS key_column(number, position)
    JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = constraint_definition.conrelid
      AND attribute.attnum = key_column.number
    WHERE constraint_definition.conrelid = 'public.partner'::regclass
      AND constraint_definition.contype = 'p'
    ORDER BY key_column.position
  ) AS primary_key
FROM scope
CROSS JOIN pg_catalog.pg_class view_relation
WHERE view_relation.oid = 'public.partners'::regclass;
