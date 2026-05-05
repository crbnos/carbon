ALTER TABLE "customField" ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE VIEW "customFieldTables" WITH(SECURITY_INVOKER=true) AS
SELECT
  cft.*,
  c.id AS "companyId",
  COALESCE(cf.fields, '[]') as fields
FROM "customFieldTable" cft
  CROSS JOIN "company" c
  LEFT JOIN (
    SELECT
      cf."table",
      cf."companyId",
      COALESCE(json_agg(
        json_build_object(
          'id', id,
          'name', name,
          'sortOrder', "sortOrder",
          'dataTypeId', "dataTypeId",
          'listOptions', "listOptions",
          'active', active,
          'tags', tags,
          'required', required
        )
      ), '[]') AS fields
    FROM "customField" cf
    GROUP BY cf."table", cf."companyId"
  ) cf
    ON cf.table = cft.table AND cf."companyId" = c.id;
