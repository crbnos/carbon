CREATE OR REPLACE VIEW "inspectionDocuments" WITH (SECURITY_INVOKER=true) AS
  SELECT
    d.*,
    i."readableIdWithRevision" AS "partReadableId"
  FROM "inspectionDocument" d
  LEFT JOIN "item" i ON i."id" = d."partId";
