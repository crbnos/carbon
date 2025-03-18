import { writeFileSync } from "fs";

const entityQuery = `
with records as (
  select
    c.oid::int8 as "id",
    nc.nspname as "schema",
    c.relname as "name",
    c.relkind as "type",
    case c.relkind
      when 'r' then 1
      when 'v' then 2
      when 'm' then 3
      when 'f' then 4
      when 'p' then 5
    end as "type_sort",
    obj_description(c.oid) as "comment",
    count(*) over() as "count",
    c.relrowsecurity as "rls_enabled"
  from
    pg_namespace nc
    join pg_class c on nc.oid = c.relnamespace
  where
    c.relkind in ('r', 'v', 'm', 'f', 'p')
    and not pg_is_other_temp_schema(nc.oid)
    and (
      pg_has_role(c.relowner, 'USAGE')
      or has_table_privilege(
        c.oid,
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
      )
      or has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
    )
    and nc.nspname in ('public')
    
  order by c.relname asc
  limit 100
  offset 0
)
select
  jsonb_build_object(
    'entities', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'schema', r.schema,
        'name', r.name,
        'type', r.type,
        'comment', r.comment,
        'rls_enabled', r.rls_enabled
      )
      order by r.name asc
    ), '[]'::jsonb),
    'count', coalesce(min(r.count), 0)
  ) "data"
from records r;
`;

(async () => {
  const entities = await fetch(
    "http://localhost:54323/api/platform/pg-meta/default/query?key=entity-types-public-0",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: entityQuery
      }),
    }
  );
  if (!entities.ok) {
    throw new Error(`HTTP error! status: ${entities.status}`);
  }
  const entitiesData = await entities.json();
  writeFileSync(
    "packages/database/src/entities.ts",
    `export default ${JSON.stringify(entitiesData, null, 2)}`
  );
  
  // const response = await fetch(
  //   "http://localhost:54323/api/projects/default/api/rest"
  // );
  // if (!response.ok) {
  //   throw new Error(`HTTP error! status: ${response.status}`);
  // }

  // const data = await response.json();

  // // write the data to a javascript file using node fs module
  // writeFileSync(
  //   "packages/database/src/swagger-docs-schema.ts",
  //   `export default ${JSON.stringify(data, null, 2)}`
  // );
})();

