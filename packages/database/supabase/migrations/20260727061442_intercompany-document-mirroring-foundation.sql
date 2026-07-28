-- Intercompany Maturity — Workstream 3 (Document Mirroring), data-model foundation
--
-- Follow-up to:
--   * 20260724100357_intercompany-maturity-matching.sql — added
--     companyGroup.intercompanyDocumentMirroring (the opt-in toggle, default off)
--     alongside the matching/FX columns.
--   * 20260725143012_intercompany-netting-foundation.sql — the group-level table +
--     cross-company RLS shape (source-OR-target company via accounting_*) that this
--     migration mirrors exactly.
--
-- This migration lands the mirroring workbench's data model only. The Inngest
-- mirror job (PO release → partner Draft SO; sales-invoice post → buyer Draft
-- purchase invoice), the accounting service functions, and the Mirroring UI are the
-- next step: they reference these new tables in TypeScript, so they ship together
-- with regenerated @carbon/database types once this migration is applied.
--
-- Two tables:
--   1. intercompanyDocumentLink — the source↔target document mirror + status machine
--      (Pending → Mirrored → Failed / Exception / Detached), per the spec DDL.
--   2. intercompanyItemLink — the explicit cross-company item reference table
--      (open-question resolution, ambition heuristic: build it now, seeded by
--      readableIdWithRevision auto-matching, rather than relying on silent readable-id
--      equality at mirror time). The mirror job resolves a source line's item to the
--      partner company's item through this table; an unmapped item fails the whole
--      mirror (Failed link), never a silent wrong-match.
--
-- Spec: .ai/specs/2026-07-04-intercompany-maturity.md (§"Data Model Changes" /
-- §3 IC document mirroring, and Open Question 5). Grounded in
-- 20260403120000_intercompany-tracking.sql (supplier/customer.intercompanyCompanyId,
-- the group-scoped RLS precedent) and 20250519122022_revisions.sql
-- (item.readableIdWithRevision, a STORED generated column).

------------------------------------------------------------------------------
-- 1. Document mirror links (group-level: intercompanyTransaction PK/RLS precedent)
--    Cross-company rows can't carry a single companyId, so — like
--    intercompanyTransaction and intercompanyNettingStatement — this uses a
--    single-column PK, companyGroupId, and explicit source/target company columns.
--    The document ids are polymorphic (purchaseOrder | salesInvoice on the source,
--    salesOrder | purchaseInvoice on the target), so they are bare TEXT with no FK.
------------------------------------------------------------------------------

CREATE TABLE "intercompanyDocumentLink" (
  "id" TEXT NOT NULL DEFAULT id('icdl'),
  "companyGroupId" TEXT NOT NULL,
  "sourceCompanyId" TEXT NOT NULL,
  "targetCompanyId" TEXT NOT NULL,
  "sourceDocumentType" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "targetDocumentType" TEXT NOT NULL,
  "targetDocumentId" TEXT,                          -- null until the mirror is created
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "failureReason" TEXT,
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT,                                 -- null when created by the mirroring job
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "intercompanyDocumentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intercompanyDocumentLink_source_key"
    UNIQUE ("sourceDocumentType", "sourceDocumentId", "sourceCompanyId"),
  CONSTRAINT "intercompanyDocumentLink_sourceDocumentType_check"
    CHECK ("sourceDocumentType" IN ('purchaseOrder', 'salesInvoice')),
  CONSTRAINT "intercompanyDocumentLink_targetDocumentType_check"
    CHECK ("targetDocumentType" IN ('salesOrder', 'purchaseInvoice')),
  CONSTRAINT "intercompanyDocumentLink_status_check"
    CHECK ("status" IN ('Pending', 'Mirrored', 'Failed', 'Exception', 'Detached')),
  CONSTRAINT "intercompanyDocumentLink_distinct_companies_check"
    CHECK ("sourceCompanyId" <> "targetCompanyId"),
  CONSTRAINT "intercompanyDocumentLink_companyGroupId_fkey"
    FOREIGN KEY ("companyGroupId") REFERENCES "companyGroup"("id") ON DELETE CASCADE,
  CONSTRAINT "intercompanyDocumentLink_sourceCompanyId_fkey"
    FOREIGN KEY ("sourceCompanyId") REFERENCES "company"("id"),
  CONSTRAINT "intercompanyDocumentLink_targetCompanyId_fkey"
    FOREIGN KEY ("targetCompanyId") REFERENCES "company"("id"),
  CONSTRAINT "intercompanyDocumentLink_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "intercompanyDocumentLink_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "intercompanyDocumentLink_companyGroupId_idx"
  ON "intercompanyDocumentLink" ("companyGroupId");
CREATE INDEX "intercompanyDocumentLink_source_idx"
  ON "intercompanyDocumentLink" ("sourceDocumentType", "sourceDocumentId");
CREATE INDEX "intercompanyDocumentLink_target_idx"
  ON "intercompanyDocumentLink" ("targetDocumentType", "targetDocumentId")
  WHERE "targetDocumentId" IS NOT NULL;
CREATE INDEX "intercompanyDocumentLink_status_idx"
  ON "intercompanyDocumentLink" ("status", "companyGroupId");

------------------------------------------------------------------------------
-- 2. Cross-company item reference table
--    Maps a source item in one group company to the corresponding item in another,
--    so the mirror job can resolve line items across the company boundary. Directional
--    (source → target): the seed inserts both directions so PO→SO (buyer item →
--    seller item) and invoice mirroring (seller item → buyer item) both resolve.
------------------------------------------------------------------------------

CREATE TABLE "intercompanyItemLink" (
  "id" TEXT NOT NULL DEFAULT id('icil'),
  "companyGroupId" TEXT NOT NULL,
  "sourceCompanyId" TEXT NOT NULL,
  "sourceItemId" TEXT NOT NULL,
  "targetCompanyId" TEXT NOT NULL,
  "targetItemId" TEXT NOT NULL,
  "readableIdWithRevision" TEXT NOT NULL,           -- the matched key at link time (audit)
  "matchMethod" TEXT NOT NULL DEFAULT 'ReadableId',
  "createdBy" TEXT,                                 -- null for the migration/job auto-seed
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "intercompanyItemLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intercompanyItemLink_source_target_key"
    UNIQUE ("sourceItemId", "targetCompanyId"),     -- one mapping per source item → target company
  CONSTRAINT "intercompanyItemLink_matchMethod_check"
    CHECK ("matchMethod" IN ('ReadableId', 'Manual')),
  CONSTRAINT "intercompanyItemLink_distinct_companies_check"
    CHECK ("sourceCompanyId" <> "targetCompanyId"),
  CONSTRAINT "intercompanyItemLink_companyGroupId_fkey"
    FOREIGN KEY ("companyGroupId") REFERENCES "companyGroup"("id") ON DELETE CASCADE,
  CONSTRAINT "intercompanyItemLink_sourceCompanyId_fkey"
    FOREIGN KEY ("sourceCompanyId") REFERENCES "company"("id"),
  CONSTRAINT "intercompanyItemLink_targetCompanyId_fkey"
    FOREIGN KEY ("targetCompanyId") REFERENCES "company"("id"),
  CONSTRAINT "intercompanyItemLink_sourceItemId_fkey"
    FOREIGN KEY ("sourceItemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "intercompanyItemLink_targetItemId_fkey"
    FOREIGN KEY ("targetItemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "intercompanyItemLink_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "intercompanyItemLink_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "intercompanyItemLink_companyGroupId_idx"
  ON "intercompanyItemLink" ("companyGroupId");
CREATE INDEX "intercompanyItemLink_sourceCompanyId_idx"
  ON "intercompanyItemLink" ("sourceCompanyId");
CREATE INDEX "intercompanyItemLink_targetCompanyId_idx"
  ON "intercompanyItemLink" ("targetCompanyId");
CREATE INDEX "intercompanyItemLink_readableIdWithRevision_idx"
  ON "intercompanyItemLink" ("readableIdWithRevision");

-- Seed the cross-company item map by auto-matching items across every ordered pair
-- of companies within the same group. Match on the item's true identity tuple
-- (readableId, revision, type) — NOT the lossy generated readableIdWithRevision, whose
-- dot-concatenation can alias two distinct items (e.g. readableId 'PART-1.2'/rev '0'
-- and 'PART-1'/rev '2' both render 'PART-1.2') and silently produce a wrong mapping.
-- item_unique is (readableId, revision, companyId, type), so this tuple is unique within
-- the target company — at most one ti per si, no fan-out. revision is compared null-safe.
-- readableIdWithRevision is still stored as the human-readable audit key. Ordered pairs
-- (ca, cb) cover both directions. createdBy is left NULL (system-seeded, not
-- user-created). Idempotent via the unique constraint + ON CONFLICT DO NOTHING.
INSERT INTO "intercompanyItemLink" (
  "companyGroupId", "sourceCompanyId", "sourceItemId",
  "targetCompanyId", "targetItemId", "readableIdWithRevision", "matchMethod"
)
SELECT
  ca."companyGroupId",
  ca."id",
  si."id",
  cb."id",
  ti."id",
  si."readableIdWithRevision",
  'ReadableId'
FROM "company" ca
JOIN "company" cb
  ON cb."companyGroupId" = ca."companyGroupId"
  AND cb."id" <> ca."id"
JOIN "item" si ON si."companyId" = ca."id"
JOIN "item" ti
  ON ti."companyId" = cb."id"
  AND ti."readableId" = si."readableId"
  AND ti."revision" IS NOT DISTINCT FROM si."revision"
  AND ti."type" = si."type"
WHERE ca."companyGroupId" IS NOT NULL
  AND si."readableIdWithRevision" IS NOT NULL
ON CONFLICT ("sourceItemId", "targetCompanyId") DO NOTHING;

------------------------------------------------------------------------------
-- 3. RLS — mirror the intercompanyTransaction / intercompanyNettingStatement policy
--    shape exactly: either company's accountants (source OR target) may view/manage,
--    gated on accounting_create / accounting_update / accounting_delete. These are
--    group-scoped cross-company rows, so the standard single-company
--    companyId = get_companies_with_employee_role() template does not apply.
------------------------------------------------------------------------------

ALTER TABLE "intercompanyDocumentLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intercompanyDocumentLink_select_policy"
  ON "intercompanyDocumentLink" FOR SELECT USING (
    "sourceCompanyId" = ANY (get_companies_with_employee_permission('accounting_create'))
    OR "targetCompanyId" = ANY (get_companies_with_employee_permission('accounting_create'))
  );

CREATE POLICY "intercompanyDocumentLink_insert_policy"
  ON "intercompanyDocumentLink" FOR INSERT WITH CHECK (
    "sourceCompanyId" = ANY (get_companies_with_employee_permission('accounting_create'))
    OR "targetCompanyId" = ANY (get_companies_with_employee_permission('accounting_create'))
  );

CREATE POLICY "intercompanyDocumentLink_update_policy"
  ON "intercompanyDocumentLink" FOR UPDATE USING (
    "sourceCompanyId" = ANY (get_companies_with_employee_permission('accounting_update'))
    OR "targetCompanyId" = ANY (get_companies_with_employee_permission('accounting_update'))
  );

CREATE POLICY "intercompanyDocumentLink_delete_policy"
  ON "intercompanyDocumentLink" FOR DELETE USING (
    "sourceCompanyId" = ANY (get_companies_with_employee_permission('accounting_delete'))
    OR "targetCompanyId" = ANY (get_companies_with_employee_permission('accounting_delete'))
  );

ALTER TABLE "intercompanyItemLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intercompanyItemLink_select_policy"
  ON "intercompanyItemLink" FOR SELECT USING (
    "sourceCompanyId" = ANY (get_companies_with_employee_permission('accounting_create'))
    OR "targetCompanyId" = ANY (get_companies_with_employee_permission('accounting_create'))
  );

CREATE POLICY "intercompanyItemLink_insert_policy"
  ON "intercompanyItemLink" FOR INSERT WITH CHECK (
    "sourceCompanyId" = ANY (get_companies_with_employee_permission('accounting_create'))
    OR "targetCompanyId" = ANY (get_companies_with_employee_permission('accounting_create'))
  );

CREATE POLICY "intercompanyItemLink_update_policy"
  ON "intercompanyItemLink" FOR UPDATE USING (
    "sourceCompanyId" = ANY (get_companies_with_employee_permission('accounting_update'))
    OR "targetCompanyId" = ANY (get_companies_with_employee_permission('accounting_update'))
  );

CREATE POLICY "intercompanyItemLink_delete_policy"
  ON "intercompanyItemLink" FOR DELETE USING (
    "sourceCompanyId" = ANY (get_companies_with_employee_permission('accounting_delete'))
    OR "targetCompanyId" = ANY (get_companies_with_employee_permission('accounting_delete'))
  );
