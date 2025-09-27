CREATE TYPE "qualityDocumentStatus" AS ENUM (
  'Draft',
  'Active',
  'Archived'
);

CREATE TABLE "qualityDocument" (
  "id" TEXT NOT NULL DEFAULT id('qdoc'),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" NUMERIC NOT NULL DEFAULT 0,
  "status" "qualityDocumentStatus" NOT NULL DEFAULT 'Draft',
  "content" JSON DEFAULT '{}',
  "assignee" TEXT,
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "qualityDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qualityDocument_version_check" CHECK ("version" >= 0),
  CONSTRAINT "qualityDocument_version_unique" UNIQUE ("name", "companyId", "version"),
  CONSTRAINT "qualityDocument_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "qualityDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qualityDocument_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "qualityDocument_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "qualityDocument_companyId_idx" ON "qualityDocument" ("companyId");

ALTER TABLE "qualityDocument" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."qualityDocument"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."qualityDocument"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."qualityDocument"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."qualityDocument"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

DROP VIEW IF EXISTS "qualityDocuments";
CREATE OR REPLACE VIEW "qualityDocuments" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    p1."id",
    p1."name",
    p1."version",
    p1."status",
    p1."assignee",
    p1."companyId",
    jsonb_agg(
      jsonb_build_object(
        'id', p2."id",
        'version', p2."version", 
        'status', p2."status"
      )
    ) as "versions"
  FROM "qualityDocument" p1
  JOIN "qualityDocument" p2 ON p1."name" = p2."name" AND p1."companyId" = p2."companyId"
  WHERE p1."version" = (
    SELECT MAX("version")
    FROM "qualityDocument" p3 
    WHERE p3."name" = p1."name"
    AND p3."companyId" = p1."companyId"
  )
  GROUP BY p1."id", p1."name", p1."version", p1."status", p1."assignee", p1."companyId";