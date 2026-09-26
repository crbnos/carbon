# Certificates of Conformance + AS9102 FAI (on the inspection architecture) — implementation plan

**Spec:** .ai/specs/2026-09-25-cofc-fai-reports.md (v2)
**Research:** .ai/research/cofc-fai-reports.md
**Run record:** .ai/runs/2026-09-25-cofc-fai-reports.md
**Branch:** kabul (Conductor workspace branch; do not rename)

All paths are relative to the repo root `/Users/barbinbrad/conductor/workspaces/carbon/kabul`.
`erp/` = `apps/erp/app/`, `mes/` = `apps/mes/app/`, `docs/` = `packages/documents/src/`,
`db/` = `packages/database/`.

Conventions every task follows (read once):
- Services: `client` first, return `{ data, error }`, never throw
  (`.claude/rules/conventions-services.md`). Multi-table writes use Kysely transactions
  in a `*.server.ts` file or in `db/src/quality.ts`, with `db: Kysely<KyselyDatabase>`
  passed in (`import type { Kysely, KyselyDatabase } from "@carbon/database/client"`);
  routes/servers pass `getDatabaseClient()` from `~/services/database.server`. NEVER build
  a DB client inside a `*.service.ts` (checked by `no-db-client-in-service`).
- Forms: `ValidatedForm` + `validator(schema)` from `@carbon/form`; validators in the
  module's `*.models.ts`.
- Strings: `const { t } = useLingui()` / `<Trans>` from `@lingui/react/macro` in
  components; `msg` from `@lingui/core/macro` in route `handle`.
- Dates: no JS `Date` arithmetic — `@internationalized/date` / `datetime` from
  `@carbon/utils`; company today = `datetime.today(await getCompanyTimeZone(client, companyId)).toString()`
  (`~/modules/shared/timezone.server`, precedent `erp/routes/x+/reports+/ar-aging.tsx:40`).
  `new Date().toISOString()` for audit timestamps is existing practice.
- Storage keys containing filenames use `stripSpecialCharacters(name) || "file"`.
- Typecheck scoped only: `pnpm exec turbo run typecheck --filter=<pkg>`.

## Progress
- [x] Task 1: Migration — enums, columns, tables, RLS, CHECKs, sequence, RPC
- [x] Task 2: Apply migration, regenerate types, seed COC sequence for new companies
- [x] Task 3: Pure bonus valuation + tests
- [x] Task 4: Measurement engine — geometric valuation, dependents, First Article sampling override
- [x] Task 5: Plan editor — designator, reference location, bonus fields, drawing revision, delete refusal message
- [x] Task 6: Measurement grids — notes per reading + allowable/bonus (ERP + MES)
- [x] Task 7: MES — Inspection operations complete only through their inspection
- [x] Task 8: Validators, enum constants, First Article assignment slot
- [x] Task 9: Requirement switches UI (company setting, customer flags)
- [x] Task 10: Certificate services + receipt-line Certificates drawer
- [x] Task 11: Certification lineage resolver + tests
- [x] Task 12: Compliance statements CRUD + nav
- [x] Task 13: `certificateOfConformance` template type, blocks, PDF, samples, test
- [x] Task 14: Certificate of Conformance email + preview fixture
- [x] Task 15: CofC data assembly + pure field-13 builder tests
- [x] Task 16: CofC server: render, issue (Kysely txn), send
- [x] Task 17: CofC routes, shipment Certificate menu, auto-issue on post
- [x] Task 18: FAI needs (pure) + due rule + tests
- [x] Task 19: FAI generation engine (`createFirstArticleInspections`)
- [x] Task 20: Release integration — readiness blocker + generation at every release path
- [x] Task 21: FAI ERP server + services (Form 2 seeding, verify/reopen/approve/delete, reads) + Form 3 derivation tests
- [x] Task 22: FAIR PDF (fixed landscape) + file route + test
- [x] Task 23: FAI ERP routes + UI (list, detail, manual create, job header)
- [x] Task 24: MES first-article route + banner
- [x] Task 25: Demo datasets — certificates
- [x] Task 26: Docs — rules + AGENTS.md
- [x] Task 27: Full scoped gate
- [x] Task 28: Browser verification via /test

## Dependencies
- Task 2 needs 1; every later task needs 2 (generated types).
- 3 → 4 → 6. 5, 7, 8, 12, 13, 14, 18, 25 are independent after 2.
- 9 needs 8. 10 needs 8. 11 needs 10. 15 needs 11, 12, 13, 18. 16 needs 13, 14, 15. 17 needs 9, 16.
- 19 needs 4, 18. 20 needs 19. 21 needs 11, 19. 22 needs 21. 23 needs 20, 21, 22. 24 needs 19.
- 26 after 23 and 24. 27 after all code tasks. 28 last.

---

## Task 1: Migration — enums, columns, tables, RLS, CHECKs, sequence, RPC

**Depends on:** none
**Files:**
- Create: `db/supabase/migrations/<timestamp>_cofc-fai-reports.sql` (via command)
- Copy from (precedent): `db/supabase/migrations/20260722040401_inbound-inspection-execution.sql`
  lines 228–548 (`save_inspection_document_atomic`, newest definition);
  `20260908142501_returns-module.sql:362-365` (sequence insert);
  `20260820215433_sso-connection.sql:27` (`num_nonnulls` CHECK)

Verified facts: single-column PK `("id")` on `receiptLine`, `jobOperation`,
`jobMakeMethod`, `trackedEntity`, `customer`, `item`, `shipment`, `supplier`, `document`,
`job`, `inspection`, `inspectionMeasurement`; `inspectionFeature` PK `("id","companyId")`
+ UNIQUE `"id"`; `customerShipping` PK `("customerId")`; `sequence` PK
`("table","companyId")`; enums `inspectionSourceDocument` = ('Receipt','Job Operation'),
`inspectionDocumentUsage` = ('Receipt').

**Steps:**
1. `pnpm db:migrate:new cofc-fai-reports`; confirm the timestamp is newer than
   `20260925121735_rpc-function-guards.sql` and HHMMSS ≠ `000000`.
2. Write this SQL:

```sql
-- ── New enums ─────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "certificateType" AS ENUM ('Material', 'Special Process', 'Functional Test', 'Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "firstArticleInspectionStatus" AS ENUM ('Draft', 'Verified', 'Approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "firstArticleInspectionScope" AS ENUM ('Full', 'Partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "firstArticleInspectionType" AS ENUM ('Detail', 'Assembly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "firstArticleInspectionReason" AS ENUM (
  'New Part', 'Design Change', 'Manufacturing Source Change', 'Process Change',
  'Inspection Method Change', 'Tooling Change', 'Material Change', 'Location Change',
  'NC Program Change', 'Natural or Man-made Event', 'Production Lapse',
  'Corrective Action', 'Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "customerApprovalVerification" AS ENUM ('Yes', 'No', 'N/A');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "materialCondition" AS ENUM ('RFS', 'MMC', 'LMC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "featureOfSizeType" AS ENUM ('Internal', 'External');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Extended enums (never USE the new values later in this file) ──────
ALTER TYPE "inspectionSourceDocument" ADD VALUE IF NOT EXISTS 'First Article';
ALTER TYPE "inspectionDocumentUsage" ADD VALUE IF NOT EXISTS 'First Article';

-- ── Plan / measurement extensions ─────────────────────────────────────
ALTER TABLE "inspectionDocument" ADD COLUMN IF NOT EXISTS "drawingRevision" TEXT;
ALTER TABLE "inspectionFeature"
  ADD COLUMN IF NOT EXISTS "designator" TEXT,
  ADD COLUMN IF NOT EXISTS "referenceLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "materialCondition" "materialCondition",
  ADD COLUMN IF NOT EXISTS "sizeFeatureId" TEXT,
  ADD COLUMN IF NOT EXISTS "featureOfSize" "featureOfSizeType";
DO $$ BEGIN
  ALTER TABLE "inspectionFeature" ADD CONSTRAINT "inspectionFeature_sizeFeatureId_fkey"
    FOREIGN KEY ("sizeFeatureId") REFERENCES "inspectionFeature"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "inspectionFeature_sizeFeatureId_idx" ON "inspectionFeature" ("sizeFeatureId");
ALTER TABLE "inspectionMeasurement"
  ADD COLUMN IF NOT EXISTS "bonus" NUMERIC,
  ADD COLUMN IF NOT EXISTS "allowable" NUMERIC;

-- ── Requirement switches ──────────────────────────────────────────────
ALTER TABLE "customerShipping"
  ADD COLUMN IF NOT EXISTS "requiresCertificateOfConformance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requiresFirstArticle" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireFirstArticle" BOOLEAN NOT NULL DEFAULT false;

-- ── Plans only on Inspection operations ───────────────────────────────
UPDATE "methodOperation" SET "inspectionDocumentId" = NULL
  WHERE "inspectionDocumentId" IS NOT NULL AND "operationType" IS DISTINCT FROM 'Inspection';
UPDATE "quoteOperation" SET "inspectionDocumentId" = NULL
  WHERE "inspectionDocumentId" IS NOT NULL AND "operationType" IS DISTINCT FROM 'Inspection';
UPDATE "jobOperation" SET "inspectionDocumentId" = NULL
  WHERE "inspectionDocumentId" IS NOT NULL AND "operationType" IS DISTINCT FROM 'Inspection';
DO $$ BEGIN
  ALTER TABLE "methodOperation" ADD CONSTRAINT "methodOperation_inspectionDocument_type_check"
    CHECK ("inspectionDocumentId" IS NULL OR "operationType" = 'Inspection');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "quoteOperation" ADD CONSTRAINT "quoteOperation_inspectionDocument_type_check"
    CHECK ("inspectionDocumentId" IS NULL OR "operationType" = 'Inspection');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_inspectionDocument_type_check"
    CHECK ("inspectionDocumentId" IS NULL OR "operationType" = 'Inspection');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── certificate ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "certificate" (
  "id" TEXT NOT NULL DEFAULT id('cert'),
  "companyId" TEXT NOT NULL,
  "type" "certificateType" NOT NULL DEFAULT 'Material',
  "certificateNumber" TEXT NOT NULL,
  "specification" TEXT,
  "supplierId" TEXT REFERENCES "supplier"("id") ON DELETE SET NULL,
  "receiptLineId" TEXT REFERENCES "receiptLine"("id") ON DELETE CASCADE,
  "jobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  "documentId" TEXT REFERENCES "document"("id") ON DELETE SET NULL,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "certificate_one_target" CHECK (num_nonnulls("receiptLineId", "jobOperationId") = 1)
);
CREATE INDEX IF NOT EXISTS "certificate_companyId_idx" ON "certificate" ("companyId");
CREATE INDEX IF NOT EXISTS "certificate_supplierId_idx" ON "certificate" ("supplierId");
CREATE INDEX IF NOT EXISTS "certificate_receiptLineId_idx" ON "certificate" ("receiptLineId");
CREATE INDEX IF NOT EXISTS "certificate_jobOperationId_idx" ON "certificate" ("jobOperationId");
CREATE INDEX IF NOT EXISTS "certificate_documentId_idx" ON "certificate" ("documentId");
CREATE INDEX IF NOT EXISTS "certificate_createdBy_idx" ON "certificate" ("createdBy");

-- ── complianceStatement / complianceStatementAssignment ───────────────
CREATE TABLE IF NOT EXISTS "complianceStatement" (
  "id" TEXT NOT NULL DEFAULT id('cst'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "appliesToAllCustomers" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "complianceStatement_companyId_idx" ON "complianceStatement" ("companyId");
CREATE INDEX IF NOT EXISTS "complianceStatement_createdBy_idx" ON "complianceStatement" ("createdBy");
DO $$ BEGIN
  ALTER TABLE "complianceStatement" ADD CONSTRAINT "complianceStatement_companyId_name_key" UNIQUE ("companyId", "name");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "complianceStatementAssignment" (
  "id" TEXT NOT NULL DEFAULT id('csa'),
  "companyId" TEXT NOT NULL,
  "complianceStatementId" TEXT NOT NULL,
  "customerId" TEXT REFERENCES "customer"("id") ON DELETE CASCADE,
  "itemId" TEXT REFERENCES "item"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("complianceStatementId", "companyId")
    REFERENCES "complianceStatement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "complianceStatementAssignment_one_target" CHECK (num_nonnulls("customerId", "itemId") = 1)
);
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_companyId_idx" ON "complianceStatementAssignment" ("companyId");
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_statement_idx" ON "complianceStatementAssignment" ("complianceStatementId");
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_customerId_idx" ON "complianceStatementAssignment" ("customerId");
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_itemId_idx" ON "complianceStatementAssignment" ("itemId");
CREATE INDEX IF NOT EXISTS "complianceStatementAssignment_createdBy_idx" ON "complianceStatementAssignment" ("createdBy");
CREATE UNIQUE INDEX IF NOT EXISTS "complianceStatementAssignment_customer_key"
  ON "complianceStatementAssignment" ("complianceStatementId", "customerId") WHERE "customerId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "complianceStatementAssignment_item_key"
  ON "complianceStatementAssignment" ("complianceStatementId", "itemId") WHERE "itemId" IS NOT NULL;

-- ── certificateOfConformance ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "certificateOfConformance" (
  "id" TEXT NOT NULL DEFAULT id('coc'),
  "companyId" TEXT NOT NULL,
  "certificateId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "shipmentId" TEXT NOT NULL REFERENCES "shipment"("id") ON DELETE CASCADE,
  "customerId" TEXT REFERENCES "customer"("id") ON DELETE SET NULL,
  "reasonForUpdate" TEXT,
  "documentId" TEXT REFERENCES "document"("id") ON DELETE SET NULL,
  "signedBy" TEXT NOT NULL REFERENCES "user"("id"),
  "signedByName" TEXT NOT NULL,
  "signedByTitle" TEXT,
  "signedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "lastSentAt" TIMESTAMP WITH TIME ZONE,
  "lastSentTo" TEXT[],
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "certificateOfConformance_reason_check" CHECK ("revision" = 0 OR "reasonForUpdate" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "certificateOfConformance_companyId_idx" ON "certificateOfConformance" ("companyId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_shipmentId_idx" ON "certificateOfConformance" ("shipmentId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_customerId_idx" ON "certificateOfConformance" ("customerId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_documentId_idx" ON "certificateOfConformance" ("documentId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_signedBy_idx" ON "certificateOfConformance" ("signedBy");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_createdBy_idx" ON "certificateOfConformance" ("createdBy");
DO $$ BEGIN
  ALTER TABLE "certificateOfConformance" ADD CONSTRAINT "certificateOfConformance_certificate_revision_key"
    UNIQUE ("companyId", "certificateId", "revision");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ── firstArticleInspection (1:1 extension of an inspection lot) ───────
CREATE TABLE IF NOT EXISTS "firstArticleInspection" (
  "id" TEXT NOT NULL DEFAULT id('fai'),
  "companyId" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL REFERENCES "inspection"("id") ON DELETE CASCADE,
  "status" "firstArticleInspectionStatus" NOT NULL DEFAULT 'Draft',
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE RESTRICT,
  "jobId" TEXT NOT NULL REFERENCES "job"("id") ON DELETE RESTRICT,
  "jobMakeMethodId" TEXT NOT NULL REFERENCES "jobMakeMethod"("id") ON DELETE RESTRICT,
  "type" "firstArticleInspectionType" NOT NULL DEFAULT 'Detail',
  "scope" "firstArticleInspectionScope" NOT NULL DEFAULT 'Full',
  "reason" "firstArticleInspectionReason" NOT NULL DEFAULT 'New Part',
  "baselineFirstArticleInspectionId" TEXT,
  "baselineReference" TEXT,
  "partNumber" TEXT NOT NULL,
  "partName" TEXT NOT NULL,
  "partRevision" TEXT,
  "drawingNumber" TEXT,
  "drawingRevision" TEXT,
  "additionalChanges" TEXT,
  "manufacturingProcessReference" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "supplierCode" TEXT,
  "purchaseOrderNumber" TEXT,
  "hasNonconformance" BOOLEAN,
  "comments" TEXT,
  "verifiedBy" TEXT REFERENCES "user"("id"),
  "verifiedByName" TEXT,
  "verifiedByTitle" TEXT,
  "verifiedAt" TIMESTAMP WITH TIME ZONE,
  "approvedBy" TEXT REFERENCES "user"("id"),
  "approvedByName" TEXT,
  "approvedByTitle" TEXT,
  "approvedAt" TIMESTAMP WITH TIME ZONE,
  "customerApprovalName" TEXT,
  "customerApprovalDate" DATE,
  "documentId" TEXT REFERENCES "document"("id") ON DELETE SET NULL,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("baselineFirstArticleInspectionId", "companyId")
    REFERENCES "firstArticleInspection"("id", "companyId") ON DELETE SET NULL ("baselineFirstArticleInspectionId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "firstArticleInspection_inspectionId_key" ON "firstArticleInspection" ("inspectionId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_companyId_idx" ON "firstArticleInspection" ("companyId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_itemId_idx" ON "firstArticleInspection" ("itemId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_jobId_idx" ON "firstArticleInspection" ("jobId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_jobMakeMethodId_idx" ON "firstArticleInspection" ("jobMakeMethodId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_baseline_idx" ON "firstArticleInspection" ("baselineFirstArticleInspectionId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_verifiedBy_idx" ON "firstArticleInspection" ("verifiedBy");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_approvedBy_idx" ON "firstArticleInspection" ("approvedBy");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_documentId_idx" ON "firstArticleInspection" ("documentId");
CREATE INDEX IF NOT EXISTS "firstArticleInspection_createdBy_idx" ON "firstArticleInspection" ("createdBy");

CREATE TABLE IF NOT EXISTS "firstArticleInspectionProduct" (
  "id" TEXT NOT NULL DEFAULT id('faid'),
  "companyId" TEXT NOT NULL,
  "firstArticleInspectionId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "kind" "certificateType" NOT NULL,
  "name" TEXT NOT NULL,
  "specification" TEXT,
  "code" TEXT,
  "supplier" TEXT,
  "customerApprovalVerification" "customerApprovalVerification" NOT NULL DEFAULT 'N/A',
  "certificateNumber" TEXT,
  "functionalTestProcedureNumber" TEXT,
  "acceptanceReportNumber" TEXT,
  "comments" TEXT,
  "certificateId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("firstArticleInspectionId", "companyId")
    REFERENCES "firstArticleInspection"("id", "companyId") ON DELETE CASCADE,
  FOREIGN KEY ("certificateId", "companyId")
    REFERENCES "certificate"("id", "companyId") ON DELETE SET NULL ("certificateId")
);
CREATE INDEX IF NOT EXISTS "firstArticleInspectionProduct_companyId_idx" ON "firstArticleInspectionProduct" ("companyId");
CREATE INDEX IF NOT EXISTS "firstArticleInspectionProduct_fai_idx" ON "firstArticleInspectionProduct" ("firstArticleInspectionId");
CREATE INDEX IF NOT EXISTS "firstArticleInspectionProduct_certificateId_idx" ON "firstArticleInspectionProduct" ("certificateId");
CREATE INDEX IF NOT EXISTS "firstArticleInspectionProduct_createdBy_idx" ON "firstArticleInspectionProduct" ("createdBy");

-- ── RLS ───────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['complianceStatement','complianceStatementAssignment',
    'firstArticleInspection','firstArticleInspectionProduct']
  LOOP
    EXECUTE format('ALTER TABLE "public".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "SELECT" ON "public".%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "INSERT" ON "public".%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "UPDATE" ON "public".%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "DELETE" ON "public".%I', t);
    EXECUTE format('CREATE POLICY "SELECT" ON "public".%I FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]))', t);
    EXECUTE format('CREATE POLICY "INSERT" ON "public".%I FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''quality_create''))::text[]))', t);
    EXECUTE format('CREATE POLICY "UPDATE" ON "public".%I FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''quality_update''))::text[]))', t);
    EXECUTE format('CREATE POLICY "DELETE" ON "public".%I FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''quality_delete''))::text[]))', t);
  END LOOP;
END $$;

ALTER TABLE "public"."certificateOfConformance" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."certificateOfConformance";
DROP POLICY IF EXISTS "INSERT" ON "public"."certificateOfConformance";
DROP POLICY IF EXISTS "UPDATE" ON "public"."certificateOfConformance";
DROP POLICY IF EXISTS "DELETE" ON "public"."certificateOfConformance";
CREATE POLICY "SELECT" ON "public"."certificateOfConformance" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
CREATE POLICY "INSERT" ON "public"."certificateOfConformance" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[]));
CREATE POLICY "UPDATE" ON "public"."certificateOfConformance" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."certificateOfConformance" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[]));

ALTER TABLE "public"."certificate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."certificate";
DROP POLICY IF EXISTS "INSERT" ON "public"."certificate";
DROP POLICY IF EXISTS "UPDATE" ON "public"."certificate";
DROP POLICY IF EXISTS "DELETE" ON "public"."certificate";
CREATE POLICY "SELECT" ON "public"."certificate" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
CREATE POLICY "INSERT" ON "public"."certificate" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[])
  OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."certificate" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[])
  OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."certificate" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[])
  OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_delete'))::text[]));

-- ── Sequence for existing companies ───────────────────────────────────
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'certificateOfConformance', 'Certificate of Conformance', 'COC', NULL, 0, 6, 1, c."id"
FROM "company" c
ON CONFLICT DO NOTHING;
```

3. Append a full `CREATE OR REPLACE FUNCTION save_inspection_document_atomic(...)` copied
   **verbatim** from `20260722040401_inbound-inspection-execution.sql` lines 234–548,
   changing only:
   - **Delete refusal** — immediately before the feature DELETE (orig. :314-321), add:
     ```sql
     SELECT f."label" INTO v_blocked_label
     FROM "inspectionFeature" f
     WHERE f."id" IN (SELECT jsonb_array_elements_text(v_features_delete))
       AND f."companyId" = p_company_id
       AND EXISTS (SELECT 1 FROM "inspectionMeasurement" m WHERE m."inspectionFeatureId" = f."id")
     LIMIT 1;
     IF v_blocked_label IS NOT NULL THEN
       RAISE EXCEPTION 'Feature "%" has recorded results and cannot be deleted', v_blocked_label
         USING ERRCODE = 'P0001';
     END IF;
     ```
     (declare `v_blocked_label TEXT;`; use the function's real company parameter name).
   - INSERT column list (orig. :334-372): append
     `"designator","referenceLocation","materialCondition","featureOfSize"` with values
     `CASE WHEN v_item ? 'designator' THEN NULLIF(v_item->>'designator','') ELSE NULL END`,
     same for `referenceLocation`, `NULLIF(v_item->>'materialCondition','')::"materialCondition"`,
     `NULLIF(v_item->>'featureOfSize','')::"featureOfSizeType"`.
   - UPDATE SET list (orig. :434-454): append `"designator" = CASE WHEN v_item ? 'designator'
     THEN NULLIF(v_item->>'designator','') ELSE "designator" END` and the same shape for
     the other three (with casts).
   - After both the create loop (which fills `featureIdMap`, orig. :375-378) and the update
     loop: for every create/update item carrying key `sizeFeatureId`, set
     `"sizeFeatureId" = COALESCE(featureIdMap->>(v_item->>'sizeFeatureId'), NULLIF(v_item->>'sizeFeatureId',''))`
     on the item's resolved feature row (creates resolved through `featureIdMap` by `tempId`).
   If the newest definition is not at those lines, STOP and report.

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: <timestamp>_cofc-fai-reports.sql, timestamp > 20260925121735, HHMMSS != 000000
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_cofc-fai-reports.sql
# Expected: 6
```

**Out of scope:** `TABLE_RENAMES` (no renames/drops); other RPCs.

## Task 2: Apply migration, regenerate types, seed COC sequence for new companies

**Depends on:** 1
**Files:**
- Modify: `db/supabase/functions/lib/seed.data.ts` — `sequences` (:233-907)
- Generated: `db/src/types.ts` (never hand-edit)

**Steps:**
1. Before applying, record how many plans the CHECK cleanup will clear (for the PR):
   `psql "$DATABASE_URL" -c "SELECT (SELECT count(*) FROM \"methodOperation\" WHERE \"inspectionDocumentId\" IS NOT NULL AND \"operationType\" IS DISTINCT FROM 'Inspection') m, (SELECT count(*) FROM \"quoteOperation\" WHERE \"inspectionDocumentId\" IS NOT NULL AND \"operationType\" IS DISTINCT FROM 'Inspection') q, (SELECT count(*) FROM \"jobOperation\" WHERE \"inspectionDocumentId\" IS NOT NULL AND \"operationType\" IS DISTINCT FROM 'Inspection') j;"`
   (use the local DB URL from `.env.local`; write the counts into the run record).
2. `pnpm db:migrate`. If the local database is not running, STOP and tell the user — never rebuild it.
3. `pnpm run generate:types`.
4. `seed.data.ts`: insert `{ table: "certificateOfConformance", name: "Certificate of Conformance", prefix: "COC", suffix: null, next: 0, size: 6, step: 1 }` in alphabetical position.

**Verify:**
```bash
grep -n "firstArticleInspectionProduct: {" packages/database/src/types.ts | head -1
# Expected: one match
grep -n '"First Article"' packages/database/src/types.ts | head
# Expected: matches in inspectionSourceDocument and inspectionDocumentUsage
```

**Out of scope:** reconciling seed migrations (the INSERT … FROM company covers existing companies).

## Task 3: Pure bonus valuation + tests

**Depends on:** 2
**Files:**
- Modify: `db/supabase/functions/shared/inspection-verdict.ts`
- Modify: `db/src/quality.ts:18,28` — re-export `valuateGeometricMeasurement`
- Modify: `db/src/inspection-verdict.test.ts`

**Steps:**
1. Add (reusing the file's `parseSpecNumber`):
```ts
export type MaterialCondition = "RFS" | "MMC" | "LMC";
export type FeatureOfSize = "Internal" | "External";
export type GeometricFeatureSpec = MeasurementFeatureSpec & {
  materialCondition: MaterialCondition | null;
  featureOfSize: FeatureOfSize | null;
};
export type SizeReading = { spec: MeasurementFeatureSpec; value: number | null; status: string };
export type GeometricValuation = { status: InspectionVerdict; bonus: number | null; allowable: number | null };
export function valuateGeometricMeasurement(
  feature: GeometricFeatureSpec, value: number | null, size: SizeReading | null
): GeometricValuation
```
   Rules:
   - RFS/null condition, non-Measurement type, or unparseable nominal →
     `{ status: valuateMeasurement(feature, value), bonus: null, allowable: null }`.
   - `stated = nominal + |tolPlus|`; `value == null` → `{ "Pending", null, stated }`.
   - No size / size value null / size nominal unparseable → `bonus = 0`.
   - `size.status === "Failed"` → `{ "Failed", 0, stated }`.
   - Else `lower = sNom − |sTolMinus|`, `upper = sNom + |sTolPlus|`,
     `internal = feature.featureOfSize !== "External"`; MMC `raw = internal ? size.value − lower : upper − size.value`;
     LMC `raw = internal ? upper − size.value : size.value − lower`;
     `bonus = min(max(raw, 0), upper − lower)`.
   - `allowable = stated + bonus`; pass iff `value >= nominal − |tolMinus| − EPSILON && value <= allowable + EPSILON`.
   - Round `bonus`/`allowable` with `round()` (default scale). Import `round`, `EPSILON`
     from `./precision.ts`; if not exported there, STOP and report.
2. Tests (feature nominal "0", +"0.010", −"0", MMC, Internal; size nominal ".250" +".005" −"0"):
   size .254 + value .013 → Passed/.004/.014; size .250 → Failed/0; no size + .009 → Passed,
   + .011 → Failed; size Failed → Failed; size .260 → bonus clamped .005; External pin
   (size .250 +0/−.005, reading .246) → .004; LMC Internal size .251 → .004; stated 0 +
   MMC + size .254 → allowable .004, .003 Passed; RFS → same as `valuateMeasurement`, bonus null.

**Verify:**
```bash
pnpm --filter @carbon/database test -- inspection-verdict
# Expected: all pass
```

**Out of scope:** datum shift.

## Task 4: Measurement engine — geometric valuation, dependents, First Article sampling override

**Depends on:** 3
**Files:**
- Modify: `db/src/quality.ts` — `upsertInspectionMeasurement` (:661), the sampling-plan
  resolution used when creating/reconciling lot plan rows (`reconcileInspectionSamplingPlans`
  and the plan-row build inside `getOrCreateJobOperationInspection` ~:1072-1250)

**Steps:**
1. Feature select (:688-697): add `"materialCondition"`, `"featureOfSize"`, `"sizeFeatureId"`.
2. Replace the `valuateMeasurement` call (~:744): for MMC/LMC with `sizeFeatureId`, load the
   size feature (`id,type,nominalValue,tolerancePlus,toleranceMinus`, companyId) and its
   measurement on `sample.id` (`value,status`) and call `valuateGeometricMeasurement`;
   otherwise `valuateMeasurement` with `bonus = allowable = null`. Add `bonus`, `allowable`
   to `measurementPayload`.
3. After writing the row, before the sample-status recompute: re-valuate dependents —
   features with `sizeFeatureId = feature.id`; for each dependent measurement on the same
   sample with non-null `value`, recompute with the new size reading and UPDATE `status,
   bonus, allowable, updatedBy, updatedAt`. Same `trx`.
4. Return `bonus` and `allowable` in addition to the existing fields.
5. Extract the per-feature plan builder into one helper
   `resolveLotFeaturePlan(sourceDocument, feature, documentDefault, lotSize, standard)`;
   when `sourceDocument === "First Article"` it returns
   `{ samplingPlanType: "All", sampleSize: 1, acceptanceNumber: 0, rejectionNumber: 1 }`;
   otherwise the existing `resolveFeatureSamplingPlan` path unchanged. Use it at every
   place in this file that builds `inspectionSamplingPlan` rows. (post-receipt's own copy
   is untouched — receipts are never First Article.)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 errors
pnpm --filter @carbon/database test
# Expected: all pass
```

**Out of scope:** the closed-lot guard; route payloads.

## Task 5: Plan editor — designator, reference location, bonus fields, drawing revision, delete refusal message

**Depends on:** 2
**Files:**
- Modify: `erp/modules/production/ui/InspectionDocument/InspectionDocumentEditor.tsx` — `FeatureRow` (:360-383), row mapping, `featureEditableComponents` (:2470-2480), columns (~:2505), `handleSave` (~:2056), save-result error handling
- Modify: `erp/modules/production/production.models.ts` — feature item schema used by `erp/routes/x+/inspection-document+/$id.save.tsx`
- Modify: `erp/modules/production/production.service.ts` — `getInspectionFeatures` select (+5 columns) and every read/write of `inspectionDocument.drawingNumber`
- Copy from (precedent): the `units` (`ConditionalMeasurementList`) and `label` (`EditableText`) columns in the same file

**Steps:**
1. `grep -rn "drawingNumber" apps/erp/app/modules/production apps/erp/app/routes/x+/inspection-document+ apps/erp/app/routes/x+/production+` — beside every edit/display of `drawingNumber` on a plan, add `drawingRevision` (same component, `t\`Drawing revision\``).
2. `FeatureRow` += `designator`, `referenceLocation`, `materialCondition` (RFS default),
   `featureOfSize` ("" default), `sizeFeatureId` ("" default); map from loaded features.
3. Columns after `units`: Designator (`EditableText`), Ref. location (`EditableText`),
   Material condition (`EditableList` RFS/MMC/LMC, Measurement rows only, else "—"), Size
   feature (`EditableList` of other rows' labels, value = id or tempId; only for MMC/LMC),
   Feature of size (`EditableList` Internal/External; only for MMC/LMC). Set `featureDirty`
   like existing columns.
4. `handleSave`: include the 5 keys per create/update item; `sizeFeatureId` = referenced
   row's id, or its tempId when that row is new.
5. Guard: MMC/LMC without a size feature blocks save with toast
   `t\`Choose the size feature for MMC/LMC characteristics\``.
6. When the save action returns an error whose message matches
   `/has recorded results and cannot be deleted/`, show it as the error toast verbatim and
   restore the deleted row locally (re-fetch the loader via `revalidator.revalidate()`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** vision auto-ballooning; sampling columns.

## Task 6: Measurement grids — notes per reading + allowable/bonus (ERP + MES)

**Depends on:** 4
**Files:**
- Modify: `erp/modules/quality/ui/Inspections/InspectionMeasurementGrid.tsx` — `MeasurementSaveResult` (:19-28), `persistMeasurement` (:180), numeric cell (:553-575), `renderPassFail` (:416-473)
- Modify: `erp/modules/quality/quality.service.ts` — `getInspectionMeasurements` select adds `notes, bonus, allowable`
- Modify: `mes/components/Inspection/InspectionMeasurementMatrix.tsx` — fetch (:231-241), `NumericCell` (:506), `PassFailCell` (:551)
- Modify: the MES measurements loader (`grep -n "inspectionMeasurement" apps/mes/app/services/quality.service.ts`) — select `notes, bonus, allowable`

**Steps:**
1. Carry `notes`, `bonus`, `allowable` in cell state (loader + save response).
2. Note affordance on every cell (numeric and pass/fail): a small note icon button
   (`LuStickyNote`) that opens a `Popover` with a `TextArea` and Save; Save re-posts the
   cell's current `value`/`passed` plus `notes` to the same endpoint (the validator and
   engine already accept `notes`). A cell with a note shows the icon filled.
3. Under a numeric value with `bonus > 0`: muted `text-xs`
   `t\`allowable ${allowable} (bonus ${bonus})\`` via the quantity formatter
   (`useQuantityFormatter` in ERP; MES: the same hook from `~/hooks` if exported, else
   `formatQuantity` from `@carbon/utils`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: 0 errors
```

**Out of scope:** sample status logic; new columns.

## Task 7: MES — Inspection operations complete only through their inspection

**Depends on:** 2
**Files:**
- Modify: `mes/routes/x+/end.$operationId.tsx` — loader
- Modify: `mes/routes/x+/complete.tsx` — action

**Steps:**
1. `end.$operationId.tsx`: after loading the operation, if `operationType === "Inspection"`,
   `throw redirect(path.to.inspection(operationId))` (use the MES path helper that
   `operation.$operationId.tsx:86-91` uses for the Inspection view; if it is named
   differently, use that name) with no quantity posted.
2. `complete.tsx`: after loading the operation, if `operationType === "Inspection"`, return
   the route's existing error shape with message
   `"Record this operation through its inspection"` and post nothing.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: 0 errors
grep -n '"Inspection"' apps/mes/app/routes/x+/end.\$operationId.tsx apps/mes/app/routes/x+/complete.tsx
# Expected: one guard in each file
```

**Out of scope:** `scrap.tsx`, `rework.tsx`, `finish.tsx` (intended escape hatches).

## Task 8: Validators, enum constants, First Article assignment slot

**Depends on:** 2
**Files:**
- Modify: `erp/modules/quality/quality.models.ts`
- Modify: `erp/modules/inventory/inventory.models.ts`
- Modify: `erp/modules/sales/sales.models.ts` — `customerShippingValidator` (:226-235)
- Modify: the company settings validator used by `erp/routes/x+/settings+/quality.tsx` (find: `grep -n "Validator" apps/erp/app/routes/x+/settings+/quality.tsx`)
- Modify: `erp/modules/quality/ui/Item/ItemQualityView.tsx` — render the First Article slot

**Steps:**
1. `quality.models.ts`:
   - `inspectionDocumentUsages` gains `"First Article"`; the inspection source filter
     options gain `"First Article"`.
   - Const arrays typed from DB enums: `certificateTypes`, `firstArticleInspectionStatuses`,
     `firstArticleInspectionScopes`, `firstArticleInspectionTypes`,
     `firstArticleInspectionReasons`, `customerApprovalVerifications`.
   - `certificateValidator`: `id?`, `type`, `certificateNumber` min(1), `specification?`,
     `notes?`, `supplierId?`, `receiptLineId?`, `jobOperationId?`, `documentId?`; refine
     exactly one of receiptLineId/jobOperationId.
   - `complianceStatementValidator`: `id?`, `name` min(1), `content` min(1),
     `appliesToAllCustomers` / `active` `zfd.checkbox()`, `customerIds?` / `itemIds?` string arrays.
   - `firstArticleInspectionCreateValidator`: `jobId`, `jobMakeMethodId`, `scope`, `reason`,
     `baselineFirstArticleInspectionId?`, `baselineReference?`; refine Partial ⇒ a baseline.
   - `firstArticleInspectionHeaderValidator`: `id`, Form 1 text fields (`partNumber`,
     `partName`, `manufacturingProcessReference`, `organizationName` min(1); others
     optional), `scope`, `reason`, baseline fields, `comments?`.
   - `firstArticleInspectionProductValidator`: `id?`, `firstArticleInspectionId`, `kind`,
     `name` min(1), optional text fields, `customerApprovalVerification`.
   - `firstArticleCustomerApprovalValidator`: `id`, `customerApprovalName?`, `customerApprovalDate?`.
2. `inventory.models.ts`: `certificateOfConformanceIssueValidator` (`reasonForUpdate?`,
   `email` checkbox, `customerContact?`, `cc?` array; refine email ⇒ contact, path
   `customerContact`) and `certificateOfConformanceSendValidator` (`customerContact` min(1),
   `cc?`). Copy the pattern of `erp/modules/invoicing/invoicing.models.ts:207`.
3. `customerShippingValidator` += `requiresCertificateOfConformance: zfd.checkbox()`,
   `requiresFirstArticle: zfd.checkbox()`.
4. Company quality settings validator += `requireFirstArticle: zfd.checkbox()`.
5. `ItemQualityView`: render one slot per value of `inspectionDocumentUsages` (if it already
   maps the const, the First Article slot appears automatically — confirm visually in
   Task 28); slot label `t\`First Article\``, help text
   `t\`Used for first article inspections of this part. Supersedes the part's only plan.\``.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** services and routes.

## Task 9: Requirement switches UI (company setting, customer flags)

**Depends on:** 8
**Files:**
- Modify: `erp/routes/x+/settings+/quality.tsx` (+ its form component) — add the company checkbox
- Modify: the company-settings update service it calls (persist `requireFirstArticle`)
- Modify: `erp/modules/sales/ui/Customer/CustomerShippingForm.tsx` — "Certifications" group
- Modify: `erp/modules/sales/sales.service.ts:3167` `updateCustomerShipping` (persist both flags if it lists columns)
- Copy from (precedent): existing `Boolean` fields in the quality settings form

**Steps:**
1. Quality settings: `<Boolean name="requireFirstArticle" label={t\`Require first article for new parts and revisions\`} description={t\`Releasing a job creates a first article inspection for every part on it that has no approved first article, or hasn't been made in two years.\`} />`.
2. Customer shipping form: a `<h3>`-level "Certifications" heading, then
   `requiresCertificateOfConformance` ("Requires Certificate of Conformance", description
   "Posting a shipment to this customer issues a certificate and emails it to the
   shipping contact.") and `requiresFirstArticle` ("Requires First Article", description
   "Releasing a job for this customer creates first article inspections for parts that
   need one.").

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the logic that reads them (Tasks 17, 18–20).

## Task 10: Certificate services + receipt-line Certificates drawer

**Depends on:** 8
**Files:**
- Modify: `erp/modules/quality/quality.service.ts` — `getCertificates`, `upsertCertificate`, `deleteCertificate`
- Create: `erp/routes/x+/receipt+/lines.$lineId.certificates.tsx`
- Create: `erp/modules/quality/ui/Certificates/{CertificatesDrawer.tsx,CertificateForm.tsx,index.ts}`
- Modify: `erp/modules/inventory/ui/Receipts/ReceiptLines.tsx` — per-line menu (:457-484)
- Modify: `erp/utils/path.ts` — `receiptLineCertificates(lineId)`
- Copy from (precedent): `erp/modules/quality/ui/IssueTypes/IssueTypeForm.tsx`; upload `ReceiptLines.tsx:1310-1363`

**Steps:**
1. Services: `getCertificates(client, companyId, { receiptLineIds?, jobOperationIds?, ids? })`
   selecting `*, supplier(id, name), document(id, name, path)`; `upsertCertificate(client, cert & { companyId; createdBy?; updatedBy? })`;
   `deleteCertificate(client, id, companyId)`.
2. Drawer from a new "Certificates" menu item: list (type, number, spec, supplier, PDF
   link), delete (disabled when read-only), add form (optional file, type, number, spec,
   supplier default = receipt's supplier, notes).
3. Client upload like `useReceiptFiles` (path `${company.id}/inventory/${lineId}/${stripSpecialCharacters(name) || "file"}`),
   then POST `path`, `name`, `size`; action: `upsertDocument` (`sourceDocument: "Receipt"`,
   `sourceDocumentId: receiptId`, read/write groups `[userId]`) then `upsertCertificate`
   with the `documentId`. `requirePermissions(request, { update: "inventory" })`.
4. `intent=delete` → `deleteCertificate` (document row stays).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** job-operation certificates UI (Task 23).

## Task 11: Certification lineage resolver + tests

**Depends on:** 10
**Files:**
- Create: `erp/modules/quality/certificationLineage.ts` (pure) + `certificationLineage.test.ts`
- Modify: `erp/modules/quality/quality.service.ts` — `getCertificationLineage`
- Modify: `erp/modules/quality/types.ts` — export `CertificationLineageRow`

**Steps:**
1. Pure exports:
```ts
export type LineageEdge = { sourceEntityId: string; id: string; attributes: Record<string, unknown> | null };
export type CertificationLineageRow = {
  kind: "Material" | "Special Process" | "Functional Test" | "Other";
  name: string; specification: string | null; supplierId: string | null; supplierName: string | null;
  certificateId: string | null; certificateNumber: string | null; documentId: string | null;
  receiptLineId: string | null; jobOperationId: string | null; trackedEntityIds: string[]; missing: boolean;
};
export async function findReceivedRoots(
  start: { id: string; attributes: Record<string, unknown> | null }[],
  fetchAncestors: (ids: string[]) => Promise<LineageEdge[]>, maxDepth = 12
): Promise<Map<string, string[]>>   // receiptLineId → root entity ids
export function dedupeLineageRows(rows: CertificationLineageRow[]): CertificationLineageRow[]
```
   Roots = entities with `attributes["Receipt Line"]`; BFS over ancestors, visited set,
   depth cap. Dedupe key `certificateId ?? "missing:" + (receiptLineId ?? jobOperationId ?? name)`, merge entity ids.
2. Tests: split-child depth 2; cycle terminates; start entity already received; dedupe merge.
3. `getCertificationLineage(client, companyId, input: { trackedEntityIds: string[] } | { jobId: string; jobMakeMethodId?: string; trackedEntityId?: string })`:
   - start entities: given ids; or `itemLedger` `documentType = 'Job Consumption'`,
     `documentId = jobId` (internal job id), `trackedEntityId not null` (+ input serial);
   - `fetchAncestors` = `rpc("get_direct_ancestors_of_tracked_entities_strict", { p_tracked_entity_ids })`;
   - receipt-line certificates → rows; lines without → `missing` rows (item name via
     `trackedEntity.itemId → item.name`; supplier via `receiptLine → receipt.supplierId`);
   - job input: `Outside Processing` ops (+ `jobMakeMethodId` filter) →
     `purchaseOrderLine.in("jobOperationId")` → `receiptLine.in("lineId")` → certificates;
     none → `missing` row (process name, PO supplier); plus certificates on all the job's ops;
   - job input: make-method `jobMaterial` whose item `type = 'Material'` and tracking not
     Batch/Serial (`grep -n "itemTrackingType" packages/database/src/types.ts | head` for the
     column) → `missing` rows;
   - `dedupeLineageRows`.
   If `receiptLine.receiptId`/`lineId` or `receipt.supplierId` don't exist, STOP and report.

**Verify:**
```bash
pnpm --filter erp test -- certificationLineage
# Expected: 4 tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** writes; UI.

## Task 12: Compliance statements CRUD + nav

**Depends on:** 8
**Files:**
- Modify: `erp/modules/quality/quality.service.ts` — `getComplianceStatements`, `getComplianceStatement`, `upsertComplianceStatement` (replaces assignments), `deleteComplianceStatement`, `getComplianceStatementsForShipment(client, companyId, { customerId, itemIds })`
- Create: `erp/routes/x+/quality+/compliance-statements.tsx`, `.new.tsx`, `.$id.tsx`, `.delete.$id.tsx`
- Create: `erp/modules/quality/ui/ComplianceStatements/{ComplianceStatementForm.tsx,ComplianceStatementsTable.tsx,index.ts}`
- Modify: `erp/modules/quality/ui/useQualitySubmodules.tsx` — Configure group (:87-111), alphabetical, icon `LuScrollText`
- Modify: `erp/utils/path.ts` — `complianceStatements`, `complianceStatement(id)`, `newComplianceStatement`, `deleteComplianceStatement(id)`
- Copy from (precedent): the four `erp/routes/x+/quality+/issue-types*.tsx` routes; `IssueTypeForm.tsx`, `IssueTypesTable.tsx`

**Steps:**
1. Mirror the issue-type routes one-to-one (permissions `quality`).
2. Form: Name, Content (`TextArea`), Applies to all customers (`Boolean`), Active
   (`Boolean`), Customers and Items multi-selects — check
   `grep -n "export" apps/erp/app/components/Form/index.ts | grep -i -E "customer|item|multi"`;
   use the multi-select components found; if none exist for customers or items, STOP and report.
3. `getComplianceStatementsForShipment`: active statements where `appliesToAllCustomers`
   OR assigned to the customer OR to any of the items; distinct; ordered by name.
4. Empty-state text: `t\`Add the statements your customers require on certificates — e.g. DFARS 252.225-7009 specialty metals, DFARS 252.246-7008 counterfeit parts, RoHS, REACH.\``

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** printing (Task 15).

## Task 13: `certificateOfConformance` template type, blocks, PDF, samples, test

**Depends on:** 2
**Files:**
- Modify: `docs/template/schema.ts` — type enum (:382-394) + `"certificateOfConformance"`; built-in blocks `conformityDetails`, `conformityStatement` via `builtInBlock(...)` in `blockSchema` (:233-261); `REGISTRATION_LINE_DOCUMENT_TYPES` (:401-409)
- Modify: `docs/template/defaults.ts` — `BLOCK_META` for both (`isBuiltIn: true, removable: false, hideable: true, addable: false`); `certificateBlocks()` (header, parties, details, lineItems, conformityDetails, conformityStatement, notes, watermark hidden); `DEFAULT_TEMPLATES.certificateOfConformance` (copy packingSlip :480-488); `DOCUMENT_CATALOG` `{ type: "certificateOfConformance", label: "Certificate of Conformance", group: "Quality", supported: true, themeColors: "full" }`
- Modify: `docs/template/merge.ts` — `CERTIFICATE_OF_CONFORMANCE_MERGE_FIELDS` + `MERGE_FIELDS` entry
- Create: `docs/pdf/CertificateOfConformancePDF.tsx`, `docs/pdf/blocks/certificateOfConformance/{types.ts,vars.ts,HeaderBlock.tsx,PartiesBlock.tsx,DetailsBlock.tsx,LineItemsBlock.tsx,ConformityDetailsBlock.tsx,ConformityStatementBlock.tsx,NotesBlock.tsx,registry.tsx,index.ts}`, `docs/pdf/certificateOfConformance.samples.ts`, `docs/pdf/CertificateOfConformancePDF.test.ts`
- Modify: `docs/pdf/preview-documents.tsx`, `docs/pdf/index.ts`
- Modify: `erp/routes/x+/templates+/$type.tsx:74-81` `TERMS_FIELD` if its type requires every key
- Copy from (precedent): `docs/pdf/PackingSlipPDF.tsx`, all of `docs/pdf/blocks/packingSlip/`, `docs/pdf/QuotePDF.test.ts`

**Steps:**
1. `CertificateOfConformanceData`:
```ts
{ company, locale, theme, sections, vars, headerOptions,
  certificate: { number: string; date: string; issued: boolean; reasonForUpdate: string | null;
                 signer: { name: string; title: string | null } | null },
  customer: { name: string; address: string[] }, purchaseOrderNumber: string | null,
  lines: { itemNumber: string; quantity: string; description: string; revision: string;
           traceability: { id: string; quantity: string }[]; remarks: string | null }[],
  conformity: { shelfLife: string[]; fairs: string[]; materialCertificates: string[];
                processCertificates: string[]; concessions: string[]; nonconformances: string[];
                statements: { name: string; content: string }[]; reasonForUpdate: string | null },
  notes?: unknown }
```
   Fields labelled "1 Page" … "14 Statement of Conformity"; empty → "N/A" (header/line) or
   "None" (field-13 groups, remarks). Title "CERTIFICATE OF CONFORMITY (in accordance with
   IAQG standard 9163)". Line rows `wrap={false}`, header row `fixed` (copy
   `docs/pdf/blocks/LineItemsBlock.tsx:42-47`). `ConformityStatementBlock`: the 9163
   statement verbatim (spec §3), "Document electronically generated and validated.",
   signer name/title/date — or "PREVIEW — NOT ISSUED" when `issued` is false.
2. `issued === false` → a `fixed`, absolutely positioned, rotated "PREVIEW" text at 0.08 opacity on every page.
3. Sample: two lines (two lots; three serials), two material certs, one FAI id, two statements.
4. Test: renders sample → `%PDF`; `issued: false` → `latin1` buffer contains `PREVIEW`.

**Verify:**
```bash
pnpm --filter @carbon/documents test
# Expected: all pass incl. CertificateOfConformancePDF.test.ts
pnpm exec turbo run typecheck --filter=@carbon/documents --filter=erp
# Expected: 0 errors
```

**Out of scope:** `Template.tsx`; ERP routes; live-record preview in `documentPreview.server.ts`.

## Task 14: Certificate of Conformance email + preview fixture

**Depends on:** 2
**Files:**
- Create: `docs/email/CertificateOfConformanceEmail.tsx`, `docs/email/previews/CertificateOfConformanceEmail.tsx`
- Modify: `docs/email/index.ts`
- Copy from (precedent): `docs/email/SalesInvoiceEmail.tsx`, `docs/email/previews/SalesInvoiceEmail.tsx`

**Steps:**
1. Props: `Email` + `certificateNumber`, `shipmentId`, `customerPurchaseOrder: string | null`,
   `lines: { itemNumber; description; quantity }[]`.
2. Body: logo row; "Hi {firstName}, please find attached Certificate of Conformance
   {certificateNumber} for shipment {shipmentId}{, PO …}."; compact line list; footer logo.
3. Preview fixture with literal props (not exported from `index.ts`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: 0 errors
```

**Out of scope:** sending.

## Task 15: CofC data assembly + pure field-13 builder tests

**Depends on:** 11, 12, 13, 18
**Files:**
- Create: `erp/modules/inventory/certificateOfConformance.ts` (pure `buildConformityDetails`) + `.test.ts`
- Modify: `erp/modules/inventory/inventory.service.ts` — `getCertificatesOfConformance`, `getCertificateOfConformanceData`

**Steps:**
1. `buildConformityDetails({ lots: { readableId; expirationDate }[], fairs: { itemReadableId; fairId }[], lineage, nonconformances: { nonConformanceId; disposition }[], statements: { id; name; content }[], reasonForUpdate, formatDate })`:
   shelfLife `"{lot}: expires {date}"`; fairs `"{item}: {fairId}"` deduped; non-missing
   lineage → Material list or process list (`"{name} — {number}{, spec}{ ({supplier})}"`);
   "Use As Is" NCRs → concessions, others → nonconformances; statements deduped by id.
2. Tests: statement dedupe; missing lineage excluded; Use-As-Is → concessions; empty inputs.
3. `getCertificateOfConformanceData(client, companyId, shipmentId)` returns the data
   contract (minus company/theme/sections/vars/headerOptions/certificate) plus
   `warnings: { faiDue: { itemReadableId; reason }[]; missingCertificates: string[] }`:
   - shipment; customer + ship-to address (reuse the lookup in `erp/routes/file+/shipment+/$id[.]pdf.tsx`);
   - PO: `salesOrder.customerReference` when `shipment.sourceDocument === "Sales Order"`;
   - lines: `shipmentLine` with `shippedQuantity > 0` joined to the `salesOrderLines` view by
     `lineId` (`sortOrder`, `customerPartId`, `customerPartRevision`); itemNumber =
     `${sortOrder + 1} / ${customerPartId ?? itemReadableId}`; revision =
     `customerPartRevision ?? item.revision ?? "N/C"`; traceability via
     `getShipmentLineTracking` (`readableId`, `quantity`);
   - lineage via `getCertificationLineage({ trackedEntityIds })`;
   - fairs: latest `firstArticleInspection` with `status = 'Approved'` per shipped `itemId`,
     joined to `inspection(inspectionId)` for the identifier;
   - NCRs: `nonConformanceShipmentLine` ∪ `nonConformanceTrackedEntity` → `nonConformance(nonConformanceId)` + item disposition;
   - statements: `getComplianceStatementsForShipment`;
   - `warnings.faiDue` from `getFirstArticleDue` (Task 18) for shipped items where a
     requirement switch applies; `missingCertificates` from missing lineage rows.
   `getCertificatesOfConformance` → rows by `revision desc`.

**Verify:**
```bash
pnpm --filter erp test -- certificateOfConformance
# Expected: pass
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** rendering/storage.

## Task 16: CofC server: render, issue (Kysely txn), send

**Depends on:** 13, 14, 15
**Files:**
- Create: `erp/modules/inventory/inventory.server.ts` (NOT exported from the module barrel)
- Copy from (precedent): render path `erp/routes/file+/shipment+/$id[.]pdf.tsx:90-225`; storage + `upsertDocument` `erp/routes/x+/shipment+/$shipmentId.post.tsx:297-335`; email `erp/routes/x+/sales-invoice+/$invoiceId.post.tsx:876-930`; `getNextSequence(trx, table, companyId)` from `@carbon/database/sequence` (precedent `db/src/quality.ts:1209-1213`)

**Steps:**
1. `renderCertificateOfConformancePdf(client, { companyId, shipmentId, locale, certificate })` → `{ data: Uint8Array | null; error }`.
2. `issueCertificateOfConformance(db, client, { companyId, shipmentId, userId, reasonForUpdate, locale })`:
   refuse unless shipment Posted ("Only posted shipments can be certified"); latest
   revision → require reason ("A reason is required to reissue"), revision n+1 / same
   number; signer = `user.fullName` + `employeeJob.title` (`getUser`
   `erp/modules/users/users.server.ts:744`, `getEmployeeJob` from `~/modules/people`);
   one Kysely transaction: sequence (revision 0) → render (`issued: true`, number via
   `withRevisionSuffix`) → upload to `${companyId}/shipment/${shipmentId}/${stripSpecialCharacters(number)}.pdf`
   (`upsert: false`; error throws) → insert `document` (same `type` value `upsertDocument`
   uses for PDFs — read `erp/modules/documents/documents.service.ts:166`;
   `sourceDocument: "Shipment"`) → insert `certificateOfConformance`. On a failure after
   upload, remove the object in the catch.
3. `sendCertificateOfConformance(client, { companyId, userId, certificateOfConformanceId, customerContactId, cc })`:
   contact email required ("The selected contact has no email address"); render
   `CertificateOfConformanceEmail` (html + text via `renderAsync`); signed URL (3600 s) of
   the stored document; `trigger("send-email", { to: [sender.email, contact.email], cc, from: sender.email, subject, html, text, attachments: [{ path: signedUrl, filename: \`${number}.pdf\` }], companyId })`;
   update `lastSentAt`, `lastSentTo`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
cat packages/checks/package.json | grep -A8 '"scripts"'
# then run its check script; Expected: no new no-db-client-in-service finding
```

**Out of scope:** routes/UI; the packing slip.

## Task 17: CofC routes, shipment Certificate menu, auto-issue on post

**Depends on:** 9, 16
**Files:**
- Create: `erp/routes/file+/shipment+/$id.certificate[.]pdf.tsx`, `erp/routes/file+/shipment+/$id.certificate.$revision[.]pdf.tsx`
- Create: `erp/routes/x+/shipment+/$shipmentId.certificate.tsx`, `erp/routes/x+/shipment+/$shipmentId.certificate.$certificateId.send.tsx`
- Create: `erp/modules/inventory/ui/Shipments/{CertificateOfConformanceMenu.tsx,CertificateOfConformanceIssueModal.tsx}`
- Modify: `erp/modules/inventory/ui/Shipments/ShipmentForm/ShipmentForm.tsx` — `actions` (:190-246), next to Packing Slip (:204-212)
- Modify: `erp/routes/x+/shipment+/$shipmentId.post.tsx` — after the packing-slip block (~:335)
- Modify: `erp/utils/path.ts` — `file.shipmentCertificate(id)`, `file.shipmentCertificateRevision(id, revision)`, `shipmentCertificate(shipmentId)`, `shipmentCertificateSend(shipmentId, certificateId)`
- Copy from (precedent): `erp/modules/invoicing/ui/SalesInvoice/SalesInvoicePostModal.tsx` (`CustomerContact`, `EmailRecipients name="cc" type="employee"`); `erp/routes/file+/shipment+/$id[.]pdf.tsx`

**Steps:**
1. Permissions: file routes `view: "inventory"`; issue/send `update: "inventory"`.
2. Menu (`LuFileBadge`, `t\`Certificate\``): Preview; Issue…/Reissue… (disabled unless
   Posted); issued revisions (number, signed date, last sent) with Download and Send….
3. Issue modal: warnings `Alert`; reason (required when a revision exists); "Email to
   customer" (default on when a default contact exists); `CustomerContact` default =
   sales order `customerContactId` if that column exists (`grep -n "customerContactId" packages/database/src/types.ts | head`)
   else `customerShipping.shippingCustomerContactId`; CC. Action: issue, then send when
   `email`; send failure after a successful issue → warning flash.
4. Post route auto-issue: after success, if `customerShipping.requiresCertificateOfConformance`
   → issue (try/catch); if issued and `shippingCustomerContactId` → send (try/catch).
   Never change the post result; flash "Certificate of Conformance {number} issued (and
   emailed to {email})" or "Shipment posted, but the certificate could not be issued: {message}".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
grep -rln "certificateOfConformance\|firstArticleInspection" apps/erp/app/routes/share+ ; echo "exit=$?"
# Expected: no files, exit=1
```

**Out of scope:** customer portal (permanently excluded).

## Task 18: FAI needs (pure) + due rule + tests

**Depends on:** 2
**Files:**
- Create: `db/src/first-article.ts` — pure, exported via the package (add `"./first-article": "./src/first-article.ts"` to `db/package.json` exports, same style as `./quality`)
- Create: `db/src/first-article.test.ts`
- Modify: `erp/modules/quality/quality.service.ts` — `getFirstArticleDue` (reads, then calls the pure function)

**Steps:**
1. Pure API (no I/O, `@internationalized/date` only):
```ts
export type FirstArticleNeedInput = {
  companyRequiresFirstArticle: boolean;
  customerRequiresFirstArticle: boolean;          // job.customerId's customerShipping flag
  today: string;                                   // YYYY-MM-DD, company tz
  makeMethods: {
    jobMakeMethodId: string; itemId: string; description: string;
    firstArticlePlanId: string | null;             // itemInspectionDocumentAssignment usage 'First Article'
    partPlanIds: string[];                         // inspectionDocument.partId = itemId
    latestApprovedAt: string | null;               // ISO, approved FAI for itemId
    lastCompletedJobDate: string | null;           // YYYY-MM-DD, other jobs of itemId
    hasFirstArticleLot: boolean;                   // this job already has one for this make method
  }[];
};
export type FirstArticleNeed = {
  jobMakeMethodId: string; itemId: string; description: string;
  required: boolean; due: boolean; reason: "New Part" | "Production Lapse" | null;
  planId: string | null; blocked: boolean; create: boolean;
};
export function evaluateFirstArticleDue(a: { latestApprovedAt: string | null; lastCompletedJobDate: string | null; today: string }): { due: boolean; reason: "New Part" | "Production Lapse" | null }
export function resolveFirstArticleNeeds(input: FirstArticleNeedInput): FirstArticleNeed[]
```
   - due: no `latestApprovedAt` → New Part; `lastCompletedJobDate + 2 years < today` and
     approval date ≤ that job date → Production Lapse; else not due.
   - required = `companyRequiresFirstArticle || customerRequiresFirstArticle || firstArticlePlanId !== null`.
   - planId = `firstArticlePlanId ?? (partPlanIds.length === 1 ? partPlanIds[0] : null)`.
   - blocked = `required && due && !hasFirstArticleLot && planId === null`.
   - create = `required && due && !hasFirstArticleLot && planId !== null`.
2. Tests: all switches off → nothing required; company on + no approval → create; FA slot
   supersedes two part plans; one part plan used; zero or two part plans without slot →
   blocked; approved recently → not due; lapse 25 months → due with Production Lapse;
   approved after lapse → not due; existing lot → neither create nor blocked.
3. `getFirstArticleDue(client, companyId, { itemIds, excludeJobId, today })` →
   `Record<itemId, { due; reason; latestFairId: string | null }>` (latest Approved
   `firstArticleInspection` per item + latest `job.completedDate` for status Completed/Closed
   excluding the job), using `evaluateFirstArticleDue`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- first-article
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp
# Expected: 0 errors
```

**Out of scope:** writes.

## Task 19: FAI generation engine (`createFirstArticleInspections`)

**Depends on:** 4, 18
**Files:**
- Modify: `db/src/quality.ts` — add `loadFirstArticleNeedInput` and `createFirstArticleInspections`
- Copy from (precedent): `getOrCreateJobOperationInspection` (`db/src/quality.ts:1072-1250`)

**Steps:**
1. `loadFirstArticleNeedInput(trx, { jobId, companyId, today })` → `FirstArticleNeedInput`:
   `companySettings.requireFirstArticle`; `job.customerId` → `customerShipping.requiresFirstArticle`;
   `jobMakeMethod` rows of the job (`id, itemId`) + item readableId/revision for
   `description`; `itemInspectionDocumentAssignment` usage `'First Article'`;
   `inspectionDocument` ids by `partId`; latest Approved `firstArticleInspection.approvedAt`
   per item; latest `job.completedDate` per item (status Completed/Closed, `id <> jobId`);
   existing `inspection` rows with `sourceDocument = 'First Article'` and
   `sourceDocumentLineId` in the make method ids.
2. `createFirstArticleInspections(db, { jobId, companyId, userId, today, only?: { jobMakeMethodId: string; scope: "Full" | "Partial"; reason: string; baselineFirstArticleInspectionId?: string; baselineReference?: string } })`
   → `Result<{ firstArticleInspectionIds: string[] }>`; one transaction:
   - needs = `resolveFirstArticleNeeds(await loadFirstArticleNeedInput(...))`; when `only`
     is given, consider only that make method and treat it as `required && due` (manual),
     still requiring a resolved plan (error "Assign a first article plan for {description}"
     when none).
   - For each `create`: `inspectionId = await getNextSequence(trx, "inspection", companyId)`;
     insert `inspection` { `sourceDocument: "First Article"`, `sourceDocumentId: job.id`,
     `sourceDocumentLineId: jobMakeMethodId`, `sourceDocumentReadableId: job.jobId`,
     `itemId`, `lotSize: 1`, `sampleSize: 1`, `inspectionDocumentId: planId`,
     `status: "Pending"`, sampling fields as `getOrCreateJobOperationInspection` sets them
     (standard from company settings), `companyId`, `createdBy` } — on unique violation
     (23505) skip that make method; insert `inspectionSamplingPlan` rows for every
     feature of the plan via `resolveLotFeaturePlan("First Article", …)` (Task 4).
   - Seed and insert `firstArticleInspection`: `partNumber` = `customerPartToItem.customerPartId`
     for (`job.customerId`, itemId) else `item.readableId`; `partName` = item name;
     `partRevision` = customer revision ?? `item.revision` ?? "N/C"; `drawingNumber` /
     `drawingRevision` from the plan's `inspectionDocument`; `additionalChanges` = change
     orders with status Done affecting any item sharing the item's `readableId`
     (`changeOrderAffectedItem` → `changeOrder`; mirror `findChangeNoticesForItem`
     `erp/modules/items/items.service.ts:6943`), joined `"{changeOrderId} {name}"`, else null;
     `manufacturingProcessReference` = `"{job.jobId} / {item.readableId}"`;
     `organizationName` = company name; `purchaseOrderNumber` = sales order
     `customerReference` when `job.salesOrderId`; `comments` = customer part mapped ?
     `"Carbon part: {readableId}"` : null; `type` = Assembly when any `jobMaterial` of the
     make method has `methodType = 'Make to Order'`, else Detail; `scope`/`reason`/baseline
     from `only` or Full + the need's reason.
   - Return the created ids.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 0 errors
```

**Out of scope:** Form 2 seeding (ERP, Task 21); release wiring (Task 20).

## Task 20: Release integration — readiness blocker + generation at every release path

**Depends on:** 19
**Files:**
- Modify: `erp/modules/production/production.service.ts` — `JobReleaseReadiness` type + `getJobReleaseReadiness`
- Modify: `erp/modules/production/production.server.ts` — refusal messages (~:181-195), `releaseJobs` (:73-136)
- Create: `erp/modules/quality/firstArticle.server.ts` — `afterJobsReleased(db, client, { jobIds, companyId, userId })`
- Modify: `erp/routes/x+/job+/$jobId.status.tsx` — plain `status=Ready` path (:136-149, :194)
- Modify: `erp/routes/api+/kanban.$id.tsx` — auto-release block (~:163-202)
- Modify: the job Release dialog component (find: `grep -rln "missingAssemblies" apps/erp/app/modules/production/ui`) and `erp/modules/production/ui/Batches/BatchReleaseModal.tsx` (:70-131)

**Steps:**
1. `JobReleaseReadiness.jobs[]` += `firstArticlesWithoutPlan: { makeMethodId: string; itemId: string; description: string }[]`.
   In `getJobReleaseReadiness`, per job: load the same inputs as `loadFirstArticleNeedInput`
   with supabase-js (company setting, customer flag, make methods + items, First Article
   assignments, part plans, approved FAIs, last completed jobs, existing FAI lots) and set
   it from `resolveFirstArticleNeeds(...).filter(n => n.blocked)` (import from
   `@carbon/database/first-article`); `today` from the company timezone.
2. Treat it like `missingAssemblies` everywhere: `production.server.ts` refusal message
   `${job.jobId}: assign a first article plan for ${descriptions}`; the job Release dialog
   and `BatchReleaseModal` list it with a link per part to its quality tab
   (`path.to.partQuality(itemId)` or the existing path for `x+/part+/$itemId.quality.tsx`)
   and disable release; `$jobId.status.tsx` plain Ready path calls
   `getJobReleaseReadiness` for the job and refuses with the same message when non-empty.
3. `afterJobsReleased`: for each job, `createFirstArticleInspections(db, { jobId, companyId, userId, today })`;
   then for each created FAI, `seedFirstArticleProducts` (Task 21). Wrap each job in
   try/catch and log — never throw.
4. Call `afterJobsReleased(getDatabaseClient(), client, …)`:
   - in `releaseJobs` after the jobs are Ready (after :101 succeeds);
   - in `$jobId.status.tsx` after the plain Ready update (:194) succeeds;
   - in `api+/kanban.$id.tsx` after the auto-release write succeeds.
   Then `grep -rn "updateJobStatus(" apps/erp/app` and confirm every call that can pass
   `"Ready"` is followed by `afterJobsReleased`; add it to any missed site.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm --filter erp test -- status
# Expected: existing $jobId.status tests pass (update mocks for the new readiness field if needed)
```

**Out of scope:** MES `autoStartJobAndOperation` (Draft → In Progress without release) — note it in the rule doc as a known gap.

## Task 21: FAI ERP server + services + Form 3 derivation tests

**Depends on:** 11, 19
**Files:**
- Create: `erp/modules/quality/firstArticleRows.ts` (pure) + `firstArticleRows.test.ts`
- Modify: `erp/modules/quality/firstArticle.server.ts` (from Task 20) — Form 2 seeding + lifecycle
- Modify: `erp/modules/quality/quality.service.ts` — reads + guarded edits

**Steps:**
1. Pure `firstArticleRows.ts`:
   - `formatRequirement(feature)`: Measurement with numeric nominal →
     `"{nominal} ±{tol}{ unit}"` when tolerances equal, else `"{nominal} +{tolPlus}/-{tolMinus}{ unit}"`,
     suffix `" Ⓜ"`/`" Ⓛ"`; otherwise `description || label`.
   - `formatResults(feature, measurement, sizeLabel)`: null when missing/Pending; numeric
     value string; "Accept"/"Reject" for non-numeric; MMC/LMC + Passed + bonus > 0 + value >
     nominal + tolPlus → append `" — Accept with MMC (bonus {bonus}, allowable {allowable}; size #{sizeLabel})"`
     (LMC wording for LMC); append `" — {notes}"` when a note exists.
   - `buildForm3Rows(features, measurementByFeatureId, ncrNumber)`: rows
     `{ featureId, characteristicNumber: label, referenceLocation, designator, requirement, results, status, nonconformanceNumber (only on Failed rows), notes }`
     sorted `localeCompare(…, { numeric: true })`; `duplicateNumbers(rows)`.
   - `indexPartType(material)`: `Material` item → null (goes to Form 2); made
     (`methodType === "Make to Order"`) → "Sub-assembly"; bought → "COTS".
   Tests: requirement ± / asymmetric / MMC / note row; results numeric / Accept / Reject /
   MMC remark only when needed / note appended; numeric sort; duplicates; index types.
2. `firstArticle.server.ts` (Kysely `db` passed in; each re-reads the extension by `id` +
   `companyId` inside its transaction and refuses when status forbids):
   - `seedFirstArticleProducts(db, client, { id, companyId, userId })`: lineage via
     `getCertificationLineage(client, companyId, { jobId, jobMakeMethodId })`, insert one
     product row per lineage row (kind, name, specification, supplier, certificateNumber,
     certificateId, comments = missing ? "No certificate on file" : null).
   - `refreshFirstArticleProducts` (Draft): insert lineage rows not already present by
     `certificateId` or missing key; never delete.
   - `verifyFirstArticleInspection` (Draft): the lot must be Passed/Failed/Partial ("Disposition
     the inspection before verifying"); `hasNonconformance` = lot Failed/Partial OR any
     `nonConformanceInspection` for the lot OR any `nonConformanceJobOperation` for the
     make method's operations; verifier snapshot (`user.fullName`, `employeeJob.title`); Verified.
   - `reopenFirstArticleInspection` (Verified → Draft, clear verifier fields).
   - `approveFirstArticleInspection(db, client, …)` (Verified): approver snapshot; render
     the FAIR PDF (Task 22's renderer) with `approved: true`; upload to
     `${companyId}/job/${jobId}/${stripSpecialCharacters(inspectionReadableId)}.pdf`;
     insert `document` (`sourceDocument: "Job"`, `sourceDocumentId: jobId`); set
     `documentId`, Approved — one transaction; remove the object on failure after upload.
   - `deleteFirstArticleInspection` (Draft and the lot has no `inspectionMeasurement`):
     delete the `inspection` (cascades the extension, products, plans, samples).
3. Services (`quality.service.ts`, `client` first):
   `getFirstArticleInspections(client, companyId, args: GenericQueryFilters & { search; status })`
   (select `*, inspection(inspectionId, status), item(readableId, name), job(jobId)`;
   precedent `getInspections` :2316-2352); `getFirstArticleInspection(client, id, companyId)`
   → extension + lot + plan features + the lot's first sample + its measurements + NCR
   number + products + derived index (make method `jobMaterial` + items + latest approved
   FAI per item); `getFirstArticleInspectionsByJob`; `updateFirstArticleInspectionHeader`,
   `upsertFirstArticleInspectionProduct`, `deleteFirstArticleInspectionProduct` (Draft
   only, else `{ error: { message: "This first article is locked" } }`);
   `updateFirstArticleCustomerApproval` (Approved only).

**Verify:**
```bash
pnpm --filter erp test -- firstArticleRows
# Expected: pass
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** routes/UI.

## Task 22: FAIR PDF (fixed landscape) + file route + test

**Depends on:** 21
**Files:**
- Create: `docs/pdf/FirstArticleInspectionPDF.tsx`, `docs/pdf/firstArticleInspection.samples.ts`, `docs/pdf/FirstArticleInspectionPDF.test.ts`
- Modify: `docs/pdf/index.ts`
- Create: `erp/modules/quality/firstArticlePdf.server.ts` — `renderFirstArticleInspectionPdf(client, { id, companyId, locale, approved })`
- Create: `erp/routes/file+/first-article+/$id[.]pdf.tsx`
- Copy from (precedent): `docs/pdf/BatchListPDF.tsx`, `docs/pdf/components/Footer.tsx:45-61`; route `erp/routes/file+/shipment+/$id[.]pdf.tsx`

**Steps:**
1. Own `<Document>` with `<Page size="A4" orientation="landscape">` per form (do not touch
   `Template.tsx`); each page has a `fixed` band with fields 1–4 (Part Number, Part Name,
   Serial Number, FAIR Identifier) and the form title, and a fixed footer "Page n of m".
2. Form 1: fields 5–26 numbered; 13 Detail/Assembly; 14 Full/Partial + baseline + reason;
   15–18 index table; 19 Yes/No; 20–25 signatures; 26 comments. Form 2 columns 5–13; Form 3
   columns 5–12 (5 number, 6 ref. location, 7 designator, 8 requirement, 9 results, 10
   tooling = note, 11 NCR, 12 comments). Rows `wrap={false}`; table header rows `fixed`.
3. DRAFT overlay (rotated text, 0.08 opacity) when not approved.
4. Renderer builds the PDF props from `getFirstArticleInspection` + `buildForm3Rows` + company.
5. Test: 300 Form 3 rows → `%PDF`; `/MediaBox` width > height (precedent `docs/pdf/productLabelPDF.test.ts:23-27`).
6. Route (`view: "quality"`): Approved with `documentId` → stream the stored file; else render live.

**Verify:**
```bash
pnpm --filter @carbon/documents test -- FirstArticleInspectionPDF
# Expected: pass
pnpm exec turbo run typecheck --filter=@carbon/documents --filter=erp
# Expected: 0 errors
```

**Out of scope:** Excel export; template customization.

## Task 23: FAI ERP routes + UI (list, detail, manual create, job header)

**Depends on:** 20, 21, 22
**Files:**
- Create: `erp/routes/x+/quality+/first-articles.tsx`
- Create: `erp/routes/x+/first-article+/{new.tsx,$id.tsx,$id.header.tsx,$id.products.tsx,$id.products.$productId.delete.tsx,$id.refresh.tsx,$id.certificates.new.tsx,$id.verify.tsx,$id.reopen.tsx,$id.approve.tsx,$id.customer-approval.tsx,delete.$id.tsx}`
- Create: `erp/modules/quality/ui/FirstArticles/{FirstArticlesTable.tsx,FirstArticleHeader.tsx,FirstArticleForm1.tsx,FirstArticleProducts.tsx,FirstArticleProductForm.tsx,FirstArticleCharacteristics.tsx,FirstArticleCreateForm.tsx,FirstArticleCustomerApprovalForm.tsx,FirstArticleStatus.tsx,index.ts}`
- Modify: `erp/modules/quality/ui/useQualitySubmodules.tsx` — Inspection group (:65-75): `{ name: t\`First Articles\`, to: path.to.firstArticles, icon: <LuClipboardList /> }`
- Modify: `erp/modules/production/ui/Jobs/JobHeader.tsx` — badge after :322, menu before Complete (~:461)
- Modify: the job loader feeding `JobHeader` (`grep -n "export async function loader" apps/erp/app/routes/x+/job+/$jobId.tsx`) — `getFirstArticleDue` for the job's make-method items (when a switch applies) + `getFirstArticleInspectionsByJob`
- Modify: `erp/utils/path.ts` — `firstArticles`, `firstArticle(id)`, `newFirstArticle`, one entry per sub-route, `file.firstArticle(id)`
- Copy from (precedent): `erp/routes/x+/quality+/inspections.tsx` + `InspectionsTable.tsx`; `erp/routes/x+/issue+/$id.tsx` + `erp/modules/quality/ui/Issue/IssueHeader.tsx`; `IssueTypeForm.tsx`; `erp/modules/sales/ui/Customer/CustomerShippingForm.tsx`; Task 10 `CertificateForm`

**Steps:**
1. List: FAIR id (the lot's `inspectionId`, link to the detail), Part, Revision, Job,
   Scope, Lot status, FAI status (`FirstArticleStatus`: Draft gray, Verified yellow,
   Approved green), Verified by, Approved by, Created.
2. `new.tsx` (`create: "quality"`): `FirstArticleCreateForm` (Job prefilled from `?jobId`;
   Make method select of the job's make methods; Scope; Reason; Baseline FAI select of
   approved FAIs for items with the same readableId; Baseline reference). Action:
   `createFirstArticleInspections(getDatabaseClient(), { …, only })` → `seedFirstArticleProducts`
   → redirect to the detail; the "Assign a first article plan" error flashes with a link to
   the part's quality tab.
3. Detail (`view: "quality"`), layout like the issue page, three cards:
   - Header (`FirstArticleHeader`): title (FAIR id + part), lot status + FAI status;
     "Record results" → `path.to.inspection(inspectionId)` (the existing execution view);
     Verify (Draft; disabled with tooltip until the lot is dispositioned), Reopen
     (Verified), Approve (Verified; confirm dialog when `verifiedBy === currentUser`:
     "You verified this first article. AS9102 recommends a different approver. Approve
     anyway?"), Customer approval (Approved), PDF (`path.to.file.firstArticle(id)`), Delete
     (Draft, `ConfirmDelete`).
   - Form 1: `FirstArticleForm1` (`ValidatedForm` → `$id.header`, disabled unless Draft),
     derived index table, signatures summary, customer approval.
   - Form 2: products table (edit/delete in Draft, "Add row", "Refresh from traceability",
     "Attach certificate" → Task 10 `CertificateForm` in job-operation mode with the make
     method's operations as options, posting to `$id.certificates.new`, which upserts the
     certificate then runs `refreshFirstArticleProducts`); "No certificate on file" rows
     show a warning icon.
   - Form 3: read-only table from `buildForm3Rows` (No., Ref. loc., Designator,
     Requirement, Results, Status badge, NCR); an `Alert` listing duplicate numbers.
   - Every action route: `requirePermissions(request, { update: "quality" })` (delete:
     `delete: "quality"`), calls the server/service function, flashes, redirects.
4. Job header: `Status` chip (as at :305-322) "FAI due" (tooltip = reason) when due and a
   switch applies and no FAI exists; "FAI open" when an FAI of the job is not Approved;
   a "First Article" dropdown listing the job's FAIs + "New First Article".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm run lint
# Expected: no errors in new/changed files
```

**Out of scope:** MES (Task 24); FAIR email.

## Task 24: MES first-article route + banner

**Depends on:** 19
**Files:**
- Create: `mes/routes/x+/first-article.$inspectionId.tsx`
- Modify: `mes/services/quality.service.ts` — `getOpenFirstArticleInspectionsForJob(client, jobId, companyId)` (inspections with `sourceDocument = 'First Article'`, `sourceDocumentId = jobId`, status not in Passed/Failed/Partial, with `sourceDocumentLineId` = make method id and item readableId)
- Modify: the MES operation views' loader(s) and the job page (`mes/routes/x+/operation.$operationId.tsx`, `mes/routes/x+/job.$jobId.tsx`, and the component rendering the operation header in `mes/components/JobOperation/`)
- Copy from (precedent): `mes/routes/x+/inspection.$operationId.tsx` (loader → `InspectionView` props), `mes/components/Inspection/InspectionView.tsx`

**Steps:**
1. Route: load the lot by id (companyId-scoped, `sourceDocument = 'First Article'`, else
   404), then build exactly the props `inspection.$operationId.tsx` builds for
   `InspectionView` (plan, features, sampling plans, samples, measurements, pdfUrl) — reuse
   its loader helper functions rather than duplicating queries; the existing
   `inspection-lot.$id.*` action routes handle writes and disposition.
2. Banner: when the operation's `jobMakeMethodId` has an open First Article lot, show an
   `Alert` "First article required for {item}" with an "Inspect" button linking to
   `/x/first-article/{id}`; same on the job page listing all open FAI lots.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: 0 errors
```

**Out of scope:** Form 1/2 editing and sign-off in the MES (ERP only).

## Task 25: Demo datasets — certificates

**Depends on:** 2
**Files:**
- Modify: `db/src/datasets/types.ts` — `ReceiptSpec.lines[]` (:935-955) += `certificate?: { type: "Material" | "Special Process" | "Functional Test" | "Other"; certificateNumber: string; specification?: string }`
- Modify: `db/src/datasets/tiers/05-purchasing.ts` — after `insertId(ctx, "receiptLine", …)` (:126-138) / ref write (:140)
- Modify: `db/src/datasets/validate.ts` — receipt block (:3027-3085) + dataset-wide checks
- Modify: `db/src/datasets/coverage.ts` — `certificate: 3`
- Modify: `db/src/datasets/data/{satellite,robotics,precision,motor}/purchasing.ts`

**Steps:**
1. Tier: Posted receipt + `receivedQuantity > 0` + `certificate` →
   `insertRow(ctx, "certificate", { companyId, type, certificateNumber, specification: specification ?? null, supplierId, receiptLineId, createdBy })`
   (use the surrounding inserts' ctx field names for company/user).
2. Validator: certificate on a non-Posted receipt or `receivedQuantity <= 0` →
   `purchasing.<ref> line <item>: certificate needs a Posted, received line`; empty number
   fails; numbers unique per dataset; ≥ 3 per dataset (`purchasing: at least 3 receipt certificates required`).
3. Data — add `certificate` inside the line object whose `item:` is at:
   - satellite `purchasing.ts:294` BAT-LIION-48V → `{ type: "Other", certificateNumber: "VCELL-COC-24-1187", specification: "UN 38.3; supplier CofC" }`
   - satellite `:306` PCB-BARE-REV3 → `{ type: "Other", certificateNumber: "PCB-COC-7741", specification: "IPC-6012 Class 3" }`
   - satellite `:347` TANK-TI-4L → `{ type: "Material", certificateNumber: "HT-24-0871", specification: "AMS 4911 Ti-6Al-4V" }`
   - robotics `:297` ENC-ABS-19 → `{ type: "Other", certificateNumber: "ENC-COC-3320", specification: "Supplier CofC" }`
   - robotics `:309` PCB-BARE-4L → `{ type: "Other", certificateNumber: "PCB-COC-5512", specification: "IPC-6012 Class 2" }`
   - robotics `:350` GBX-HD-80 → `{ type: "Other", certificateNumber: "GBX-COC-0917", specification: "Supplier CofC; ISO 1328 grade 6" }`
   - precision `:300` BRG-DBL-6205 → `{ type: "Other", certificateNumber: "BRG-COC-6205-44", specification: "ABEC 7" }`
   - precision `:353` MAT-SS316-PLT → `{ type: "Material", certificateNumber: "HT-316-55012", specification: "ASTM A240 316L plate" }`
   - precision `:539` BSH-PTFE-2012 → `{ type: "Other", certificateNumber: "PTFE-COC-2012", specification: "ASTM D4894" }`
   - motor `:300` MAT-CU-18AWG → `{ type: "Material", certificateNumber: "CU-18-66310", specification: "ASTM B3 annealed copper" }`
   - motor `:312` MAT-INS-NOMEX → `{ type: "Material", certificateNumber: "NMX-410-2291", specification: "Nomex 410" }`
   - motor `:353` MAT-AL6061-BAR → `{ type: "Material", certificateNumber: "HT-6061-88420", specification: "AMS-QQ-A-225/8 T6511 bar" }`
   If a line number moved, find the item key within the same receipt (`receipt:paid`,
   `receipt:short`, `receipt:midway-paid`, `receipt:bluestem-short`,
   `receipt:midway-restock`, `receipt:wire-paid`); never pick other lines.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass (validator, apply/rollback, coverage incl. certificate)
```

**Out of scope:** seeding FAIs, CofCs, compliance statements, certificate PDFs.

## Task 26: Docs — rules + AGENTS.md

**Depends on:** 23, 24
**Files:**
- Create: `.claude/rules/quality-certification-documents.md` (`paths:` covering `erp/modules/quality/{certificationLineage,firstArticleRows,firstArticle.server,firstArticlePdf.server}.ts`, `erp/modules/inventory/{certificateOfConformance.ts,inventory.server.ts}`, `erp/routes/x+/first-article+/**`, `erp/routes/x+/shipment+/$shipmentId.certificate*.tsx`, `db/src/first-article.ts`, `docs/pdf/{CertificateOfConformancePDF,FirstArticleInspectionPDF}.tsx`, `docs/pdf/blocks/certificateOfConformance/**`, `mes/routes/x+/first-article.$inspectionId.tsx`)
- Modify: `.claude/rules/inspection-system.md` — `First Article` source + usage, forced All/n=1, bonus tolerance, notes, delete refusal, CHECK on operation plans, MES completion guards
- Modify: `.claude/rules/document-template-customizer.md` — 12 types; the two new blocks
- Modify: `apps/erp/app/modules/quality/AGENTS.md`, `apps/erp/app/modules/production/AGENTS.md` (readiness field + `afterJobsReleased`)
- Modify: `AGENTS.md` — Task Router row "Certificates of Conformance / First Article (AS9102)"

**Steps:**
1. The new rule covers: certificates + lineage + `missing` rows; CofC lifecycle (preview,
   issue, reissue with reason, stored PDF, email, auto-issue, never the portal — share
   pages are unauthenticated); FAI = inspection lot + extension; the three switches; plan
   rule (First Article slot supersedes the part's only plan, else release blocker); one
   pure `resolveFirstArticleNeeds` shared by the blocker and the generator; generation via
   `afterJobsReleased` at every release call site; lifecycle; stored PDF as the record;
   known gap: MES auto-start of a Draft job skips release.

**Verify:**
```bash
grep -n "quality-certification-documents" AGENTS.md
# Expected: one row
```

**Out of scope:** public docs site.

## Task 27: Full scoped gate

**Depends on:** 3–26
**Steps:**
1. `pnpm run lint`
2. `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/documents --filter=@carbon/database`
3. `pnpm --filter @carbon/database test`, `pnpm --filter @carbon/documents test`, `pnpm --filter erp test`
4. `pnpm db:check:datasets`, `pnpm db:check:backups` (migrated DB)
5. `pnpm lingui:extract` then `/translate` if new strings have empty `msgstr`.

**Verify:**
```bash
pnpm run lint && pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/documents --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** whole-repo typecheck.

## Task 28: Browser verification via /test

**Depends on:** 27
**Steps:** `/test` against the spec's acceptance criteria (dev stack + `/auth`). Minimum flows:
1. Receipt line → Certificates → add with a PDF; it lists.
2. Compliance statements (company-wide + customer); customer "Requires CofC" + shipping contact.
3. Post a shipment → certificate issued + emailed flash; menu lists revision 0; Download
   shows fields 1–14 + statements; Reissue with a reason → `-1`.
4. Company "Require first article" on; part with two plans and no First Article slot →
   release blocked naming the part; assign the slot → release creates the FAI; MES banner
   → Inspect → record every feature (one note, one MMC position + size showing
   allowable/bonus) → Accept; ERP FAI: Form 3 complete, Verify → Approve (same-user
   warning) → PDF landscape, stored on the job; edits refused; customer approval saved.
5. Traveler Complete scan on an Inspection operation opens the inspection; deleting a
   measured feature in the plan editor is refused.
Screenshots to `.context/`; results into the run record.

**Verify:** `/test` pass/fail table — every flow passes.
